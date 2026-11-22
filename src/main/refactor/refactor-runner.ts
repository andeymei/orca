import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk'
import { openClaudeStreamJsonConnection } from '../claude/claude-stream-json-connection'
import { readNodeFileWithinLimit } from '../../shared/file-content/node-bounded-file-reader'
import { RefactorManifest } from '../../shared/refactor/refactor-manifest'
import type { RefactorStatusResult } from '../../shared/rpc-contract/refactor-params'
import { refactorToolAllowed, refactorToolTargetPath } from './refactor-write-gate'
import type { RefactorAgentLaunch } from './refactor-agent-launch'

/** A turn that runs longer than this is killed: the agent gets no second chance at the same file. */
export const REFACTOR_TURN_TIMEOUT_MS = 300_000

/** The manifest is agent-authored input, so it is read under a cap. */
const REFACTOR_MANIFEST_MAX_BYTES = 1024 * 1024

const REFACTOR_ERROR_SUBTYPES = new Set([
  'error_during_execution',
  'error_max_turns',
  'error_max_budget_usd',
  'error_max_structured_output_retries'
])

const WRITE_TOOL_NAMES = new Set(['Write', 'Edit', 'MultiEdit'])

export type RefactorTurnResult = {
  state: RefactorStatusResult['state']
  manifest: RefactorManifest | null
  progress: string
  warnings: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function refactorToolProgressText(
  toolName: string,
  toolInput: Record<string, unknown>,
  workspaceRoot: string
): string {
  const target = refactorToolTargetPath(toolInput)
  if (!target) {
    return `正在使用 ${toolName}`
  }
  const relative = path.relative(workspaceRoot, path.resolve(workspaceRoot, target))
  if (toolName === 'Read') {
    return `正在读取 ${relative}`
  }
  if (WRITE_TOOL_NAMES.has(toolName)) {
    return `正在写入 ${relative}`
  }
  return `正在使用 ${toolName}`
}

export function parseRefactorToolProgress(
  message: Record<string, unknown>,
  workspaceRoot: string
): string | null {
  const envelope = message.message
  if (!isRecord(envelope)) {
    return null
  }
  const content = envelope.content
  if (!Array.isArray(content)) {
    return null
  }
  for (const block of content) {
    if (!isRecord(block) || block.type !== 'tool_use') {
      continue
    }
    const toolName = typeof block.name === 'string' ? block.name : ''
    if (!toolName) {
      continue
    }
    const toolInput = isRecord(block.input) ? block.input : {}
    return refactorToolProgressText(toolName, toolInput, workspaceRoot)
  }
  return null
}

function classifyRefactorResult(message: Record<string, unknown>): {
  state: 'done' | 'failed'
  warnings: string[]
} {
  const subtype = typeof message.subtype === 'string' ? message.subtype : ''
  const stopReason = typeof message.stop_reason === 'string' ? message.stop_reason : ''
  const failed = REFACTOR_ERROR_SUBTYPES.has(subtype) || message.is_error === true
  if (!failed) {
    return { state: 'done', warnings: [] }
  }
  // A success subtype with is_error means the turn ended on an API error, not on a broken subtype.
  const detail = REFACTOR_ERROR_SUBTYPES.has(subtype) ? subtype : 'api_error'
  const stop = stopReason.length > 0 ? `（停止原因：${stopReason}）` : ''
  return { state: 'failed', warnings: [`这一轮以错误结束：${detail}${stop}`] }
}

async function readRefactorManifest(scratchRoot: string): Promise<{
  manifest: RefactorManifest | null
  warnings: string[]
}> {
  const manifestPath = path.join(scratchRoot, 'manifest.json')
  let text: string
  try {
    const read = await readNodeFileWithinLimit(manifestPath, REFACTOR_MANIFEST_MAX_BYTES)
    text = read.buffer.toString('utf8')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { manifest: null, warnings: [`读取清单失败：${reason}`] }
  }
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(text)
  } catch {
    return { manifest: null, warnings: ['清单不是合法的 JSON'] }
  }
  const parsed = RefactorManifest.safeParse(parsedJson)
  if (!parsed.success) {
    return { manifest: null, warnings: ['清单的形状不符合约定'] }
  }
  return { manifest: parsed.data, warnings: [] }
}

/**
 * The gate resolves relative tool paths against the workspace root while the SDK resolves them
 * against the process cwd; a gap between the two lets the gate approve a path the SDK writes
 * outside the scratch root.
 */
function assertRefactorWorkspaceRoot(workspaceRoot: string, launchCwd: string): void {
  const left = path.resolve(workspaceRoot)
  const right = path.resolve(launchCwd)
  const same =
    process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
  if (!same) {
    throw new Error(`refactor workspace root ${left} does not match the agent cwd ${right}`)
  }
}

export async function runRefactorTurn(input: {
  launch: RefactorAgentLaunch
  scratchRoot: string
  workspaceRoot: string
  prompt: { system: string; user: string }
  onProgress?: (text: string) => void
  signal: AbortSignal
}): Promise<RefactorTurnResult> {
  const { launch, scratchRoot, workspaceRoot, prompt, onProgress, signal } = input
  assertRefactorWorkspaceRoot(workspaceRoot, launch.cwd)

  let order = 0
  let progress = ''
  let resultOrder = -1
  let resultState: 'done' | 'failed' = 'done'
  let resultWarnings: string[] = []
  let cancelOrder = -1
  let timedOut = false
  let faultMessage = ''

  const finished = Promise.withResolvers<void>()
  const settle = (): void => {
    finished.resolve()
  }

  const canUseTool: CanUseTool = (toolName, toolInput) => {
    const allowed = refactorToolAllowed({ toolName, toolInput, scratchRoot, workspaceRoot })
    // A null result leaves the tool blocked forever, so every call gets an explicit verdict.
    return Promise.resolve(
      allowed ? { behavior: 'allow' } : { behavior: 'deny', message: '该工具在此任务中不可用。' }
    )
  }

  const onMessage = (message: Record<string, unknown>): void => {
    const text = parseRefactorToolProgress(message, workspaceRoot)
    if (text !== null) {
      progress = text
      onProgress?.(text)
    }
    if (message.type === 'result') {
      const outcome = classifyRefactorResult(message)
      resultOrder = ++order
      resultState = outcome.state
      resultWarnings = outcome.warnings
      settle()
    }
  }

  const onFault = (error: Error): void => {
    faultMessage = error.message
    settle()
  }

  const onExit = (error: Error, exit?: { expected: boolean }): void => {
    // An expected exit is the close this runner asked for; only an unsolicited one is a fault.
    if (exit?.expected === true) {
      return
    }
    faultMessage = error.message
    settle()
  }

  const onAbort = (): void => {
    cancelOrder = ++order
    settle()
  }

  const timer = setTimeout(() => {
    timedOut = true
    settle()
  }, REFACTOR_TURN_TIMEOUT_MS)

  let connection: Awaited<ReturnType<typeof openClaudeStreamJsonConnection>> | null = null
  try {
    connection = await openClaudeStreamJsonConnection(launch, {
      onMessage,
      canUseTool,
      onFault,
      onExit
    })
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
    }
    await connection.send({
      type: 'user',
      uuid: randomUUID(),
      message: { role: 'user', content: `${prompt.system}\n\n${prompt.user}` },
      parent_tool_use_id: null,
      session_id: randomUUID()
    })
    await finished.promise
  } catch (error) {
    faultMessage = error instanceof Error ? error.message : String(error)
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    // Closing drains the reader, so a result frame the exit raced with still reaches onMessage.
    await connection?.close()
  }

  const cancelledFirst = cancelOrder >= 0 && (resultOrder < 0 || cancelOrder < resultOrder)
  let state: RefactorStatusResult['state']
  let warnings: string[]
  if (cancelledFirst) {
    state = 'cancelled'
    warnings = ['任务已取消']
  } else if (resultOrder >= 0) {
    state = resultState
    warnings = resultWarnings
  } else if (timedOut) {
    state = 'failed'
    warnings = ['任务超时']
  } else if (faultMessage) {
    state = 'failed'
    warnings = [`这一轮没有正常结束：${faultMessage}`]
  } else {
    state = 'failed'
    warnings = ['这一轮没有结束']
  }

  const manifest = await readRefactorManifest(scratchRoot)
  return {
    state,
    manifest: manifest.manifest,
    progress,
    warnings: [...warnings, ...manifest.warnings]
  }
}
