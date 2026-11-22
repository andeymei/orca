import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk'
import { openClaudeStreamJsonConnection } from '../claude/claude-stream-json-connection'
import { readNodeFileWithinLimit } from '../../shared/file-content/node-bounded-file-reader'
import { RefactorManifest } from '../../shared/refactor/refactor-manifest'
import type { RefactorStatusResult } from '../../shared/rpc-contract/refactor-params'
import {
  refactorToolAllowed,
  resolveRefactorGateRoots,
  type RefactorGateRoots
} from './refactor-write-gate'
import type { RefactorAgentLaunch } from './refactor-agent-launch'
import { createRefactorToolHook, refactorToolDenyMessage } from './refactor-tool-hook'
import { parseRefactorToolProgress } from './refactor-tool-progress'
import { resolvePhysicalPath } from './refactor-physical-path'
import {
  closeRefactorTurnConnection,
  type RefactorTurnConnection,
  type RefactorTurnConnectionFactory
} from './refactor-turn-connection'
import {
  classifyRefactorResult,
  decideRefactorTurnOutcome,
  refactorFaultDetail,
  refactorTurnCancelledFirst
} from './refactor-turn-verdict'

export { parseRefactorToolProgress } from './refactor-tool-progress'

export {
  classifyRefactorResult,
  decideRefactorTurnOutcome,
  refactorFaultDetail,
  refactorTurnCancelledFirst
} from './refactor-turn-verdict'

/** A turn that runs longer than this is killed: the agent gets no second chance at the same file. */
export const REFACTOR_TURN_TIMEOUT_MS = 300_000

/** The manifest is agent-authored input, so it is read under a cap. */
const REFACTOR_MANIFEST_MAX_BYTES = 1024 * 1024

export type RefactorTurnResult = {
  state: RefactorStatusResult['state']
  manifest: RefactorManifest | null
  progress: string
  warnings: string[]
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
 *
 * Why the physical paths: the CLI resolves its own working directory to the real path, so the
 * two have to be compared as the places they are rather than as the ways they are written.
 */
async function assertRefactorWorkspaceRoot(
  roots: RefactorGateRoots,
  launchCwd: string
): Promise<void> {
  const physicalCwd = await resolvePhysicalPath(path.resolve(launchCwd))
  const workspace = roots.physicalWorkspaceRoot
  const same =
    physicalCwd !== null &&
    (process.platform === 'win32'
      ? physicalCwd.toLowerCase() === workspace.toLowerCase()
      : physicalCwd === workspace)
  if (!same) {
    throw new Error(
      `refactor workspace root ${roots.workspaceRoot} does not match the agent cwd ${launchCwd}`
    )
  }
}

/**
 * A relative scratch root is resolved against the workspace root: the prompt names the scratch
 * root relative to the workspace, so that is the base it means.
 */
function resolveRefactorScratchRoot(workspaceRoot: string, scratchRoot: string): string {
  return path.isAbsolute(scratchRoot)
    ? path.resolve(scratchRoot)
    : path.resolve(workspaceRoot, scratchRoot)
}

/**
 * The prompt names a relative scratch root while the gate and the manifest read use an absolute
 * one; when they are not the same directory every relative write is refused and the manifest is
 * read from a tree nobody wrote. The scratch root must be strictly inside the workspace: the
 * workspace root itself would let the gate approve a write to the user's own sources.
 *
 * Why the physical paths: a scratch root that is a link out of the workspace passes a comparison
 * of the two spellings, and the gate would then approve writes to a tree outside the workspace.
 */
function assertRefactorScratchRoot(roots: RefactorGateRoots): void {
  const relative = path.relative(roots.physicalWorkspaceRoot, roots.physicalScratchRoot)
  const [firstSegment] = relative.split(path.sep)
  if (relative === '' || firstSegment === '..' || path.isAbsolute(relative)) {
    throw new Error(
      `refactor scratch root ${roots.scratchRoot} is not strictly inside the workspace root ${roots.workspaceRoot}`
    )
  }
}

/**
 * The SDK auto-approves a tool whose bare name sits in `allowedTools` and never calls
 * `canUseTool`, and a bypass permission mode approves everything; in both cases the gate is
 * never consulted, so the launch is refused instead of running ungated.
 */
function assertRefactorLaunchGates(launch: RefactorAgentLaunch): void {
  const permissionMode = launch.options.permissionMode
  if (permissionMode !== 'default') {
    throw new Error(
      `refactor launch permission mode ${String(permissionMode)} would skip the tool gate`
    )
  }
  const bareTools = (launch.options.allowedTools ?? []).filter(
    (tool) => tool.length > 0 && !tool.includes('(')
  )
  if (bareTools.length > 0) {
    throw new Error(`refactor launch auto-approves bare tools: ${bareTools.join(', ')}`)
  }
}

export async function runRefactorTurn(input: {
  launch: RefactorAgentLaunch
  scratchRoot: string
  workspaceRoot: string
  prompt: { system: string; user: string }
  onProgress?: (text: string) => void
  signal: AbortSignal
  /** The seam the tests drive; the real connection is opened when it is absent. */
  openConnection?: RefactorTurnConnectionFactory
}): Promise<RefactorTurnResult> {
  const { launch, workspaceRoot, prompt, onProgress, signal } = input
  const scratchRoot = resolveRefactorScratchRoot(workspaceRoot, input.scratchRoot)
  const roots = await resolveRefactorGateRoots({ scratchRoot, workspaceRoot })
  await assertRefactorWorkspaceRoot(roots, launch.cwd)
  assertRefactorScratchRoot(roots)
  assertRefactorLaunchGates(launch)

  // The gate hangs on a hook because an allow rule in a settings tier approves a tool before the
  // canUseTool callback is consulted.
  const gatedLaunch: RefactorAgentLaunch = {
    ...launch,
    options: {
      ...launch.options,
      hooks: {
        ...launch.options.hooks,
        PreToolUse: [
          ...(launch.options.hooks?.PreToolUse ?? []),
          ...createRefactorToolHook({ roots })
        ]
      }
    }
  }

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

  const denyMessage = (toolName: string, toolInput: Record<string, unknown>): string =>
    refactorToolDenyMessage({ toolName, toolInput, scratchRoot: roots.scratchRoot })

  const canUseTool: CanUseTool = async (toolName, toolInput) => {
    try {
      const allowed = await refactorToolAllowed({ toolName, toolInput, roots })
      // A null result leaves the tool blocked forever, so every call gets an explicit verdict.
      return allowed
        ? { behavior: 'allow' }
        : { behavior: 'deny', message: denyMessage(toolName, toolInput) }
    } catch {
      // Fail closed, and never throw: an unanswered callback leaves the tool blocked forever.
      return { behavior: 'deny', message: denyMessage(toolName, toolInput) }
    }
  }

  const onMessage = (message: Record<string, unknown>): void => {
    const text = parseRefactorToolProgress(message, roots)
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
    faultMessage = refactorFaultDetail(error)
    settle()
  }

  const onExit = (error: Error, exit?: { expected: boolean }): void => {
    // An expected exit is the close this runner asked for; only an unsolicited one is a fault.
    if (exit?.expected === true) {
      return
    }
    faultMessage = refactorFaultDetail(error)
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

  const closeWarnings: string[] = []
  const openConnection: RefactorTurnConnectionFactory =
    input.openConnection ?? openClaudeStreamJsonConnection
  let connection: RefactorTurnConnection | null = null
  try {
    connection = await openConnection(gatedLaunch, {
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
    faultMessage = error instanceof Error ? refactorFaultDetail(error) : String(error)
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    // Closing drains the reader, so a result frame the exit raced with still reaches onMessage.
    closeWarnings.push(...(await closeRefactorTurnConnection(connection)))
  }

  const outcome = decideRefactorTurnOutcome({
    result: resultOrder >= 0 ? { state: resultState, warnings: resultWarnings } : null,
    cancelled: refactorTurnCancelledFirst({ cancelOrder, resultOrder }),
    timedOut,
    fault: faultMessage.length > 0 ? faultMessage : null
  })

  const manifest = await readRefactorManifest(scratchRoot)
  return {
    state: outcome.state,
    manifest: manifest.manifest,
    progress,
    warnings: [...outcome.warnings, ...closeWarnings, ...manifest.warnings]
  }
}
