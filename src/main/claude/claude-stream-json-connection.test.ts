import { execFileSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawnProcess } from '@orca/process-host'
import type { ProcessSpec } from '@orca/process-host/process-spec'
import type { HookCallback, HookInput, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk'

import {
  openClaudeStreamJsonConnection,
  type ClaudeStreamJsonConnection,
  type ClaudeStreamJsonLaunch
} from './claude-stream-json-connection'
import { CLAUDE_STRUCTURED_BASE_OPTIONS } from './structured/launch/claude-structured-launch-resolution'

// Exercise the real SDK against a scripted child CLI.
const FAKE_CLI = join(__dirname, '__fixtures__', 'claude-agent-sdk-scripted-cli.mjs')
const SESSION_ID = '5348c19f-6a54-4c2e-9c68-9c2b1a3d4e5f'
const HOLD_OPEN = { delayMs: 10_000 }

/** The file the gate has to refuse: the user's own source, outside every scratch tree. */
const USER_SOURCE = '/work/repo/src/foo.ts'

type RegisteredHook = {
  matcher?: string
  hookCallbackIds?: string[]
  timeout?: number
  onFailure?: string
}

type ScriptedCliReport = {
  argv: string[]
  controlRequests: {
    request_id: string
    request: { subtype: string; hooks?: { PreToolUse?: RegisteredHook[] } }
  }[]
  controlResponses: { response: { request_id: string; response?: unknown } }[]
  controlAnswers: { request_id: string; subtype: string | null; answer: unknown }[]
  userMessages: Record<string, unknown>[]
  descendantPid: number | null
}

const scratchDirs: string[] = []
const openConnections: ClaudeStreamJsonConnection[] = []
const childClosures: Promise<void>[] = []

afterEach(async () => {
  for (const connection of openConnections.splice(0)) {
    await connection.close()
  }
  await Promise.all(childClosures.splice(0))
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
  spawned.splice(0)
  spawnedChildren.splice(0)
  vi.unstubAllEnvs()
})

function scriptScenario(
  steps: Record<string, unknown>[],
  controlResponses: Record<string, unknown> = {}
) {
  const dir = mkdtempSync(join(tmpdir(), 'claude-sdk-connection-'))
  scratchDirs.push(dir)
  const scenarioPath = join(dir, 'scenario.json')
  const reportPath = join(dir, 'report.json')
  writeFileSync(scenarioPath, JSON.stringify({ steps, controlResponses }))
  return {
    cwd: dir,
    env: {
      PATH: process.env.PATH ?? '',
      ORCA_SDK_CONTRACT_SCENARIO_PATH: scenarioPath,
      ORCA_SDK_CONTRACT_REPORT_PATH: reportPath
    },
    readReport: () => JSON.parse(readFileSync(reportPath, 'utf8')) as ScriptedCliReport
  }
}

function launchFor(
  scenario: { cwd: string; env: Record<string, string> },
  env: Record<string, string> = {}
): ClaudeStreamJsonLaunch {
  return {
    pathToClaudeCodeExecutable: FAKE_CLI,
    options: { ...CLAUDE_STRUCTURED_BASE_OPTIONS, sessionId: SESSION_ID },
    cwd: scenario.cwd,
    env: { ...scenario.env, ...env }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toolPath(toolInput: unknown): string | null {
  if (!isRecord(toolInput)) {
    return null
  }
  const target = toolInput.file_path
  return typeof target === 'string' ? target : null
}

/**
 * The gate the refactor runner hangs on a PreToolUse hook: a write to the user's own sources
 * is refused with a reason that names the tool and the path. The matcher carries no pattern and
 * blocks on failure, which is the shape the runner hands over.
 */
const gateHook: HookCallback = async (input: HookInput): Promise<HookJSONOutput> => {
  if (input.hook_event_name !== 'PreToolUse') {
    return {}
  }
  const target = toolPath(input.tool_input)
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `该工具在此任务中不可用：${input.tool_name} 只能写暂存目录下的文件；被拒绝的路径：${target ?? '未知的路径'}。`
    }
  }
}

/** The launch carries the gate beside another matcher, so the gate is found by identity, not by position. */
function launchWithGate(scenario: {
  cwd: string
  env: Record<string, string>
}): ClaudeStreamJsonLaunch {
  const launch = launchFor(scenario)
  return {
    ...launch,
    options: {
      ...launch.options,
      hooks: {
        PreToolUse: [
          { matcher: 'Read', hooks: [async () => ({})] },
          { hooks: [gateHook], onFailure: 'block' }
        ]
      }
    }
  }
}

function denyReason(response: unknown): string | null {
  if (!isRecord(response)) {
    return null
  }
  const specific = response.hookSpecificOutput
  if (!isRecord(specific)) {
    return null
  }
  if (specific.hookEventName !== 'PreToolUse' || specific.permissionDecision !== 'deny') {
    return null
  }
  const reason = specific.permissionDecisionReason
  return typeof reason === 'string' ? reason : null
}

const spawned: ProcessSpec[] = []
const spawnedChildren: ChildProcess[] = []

async function open(
  launch: ClaudeStreamJsonLaunch,
  handlers: Parameters<typeof openClaudeStreamJsonConnection>[1] = {}
): Promise<ClaudeStreamJsonConnection> {
  const connection = await openClaudeStreamJsonConnection(launch, handlers, (spec) => {
    spawned.push(spec)
    const child = spawnProcess(spec)
    spawnedChildren.push(child)
    childClosures.push(new Promise<void>((resolve) => child.once('close', () => resolve())))
    return child
  })
  openConnections.push(connection)
  return connection
}

async function until<T>(read: () => T | null | undefined, label: string): Promise<T> {
  for (let attempt = 0; attempt < 400; attempt++) {
    const value = read()
    if (value !== null && value !== undefined) {
      return value
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`timed out waiting for ${label}`)
}

function readReportSafely(scenario: { readReport: () => ScriptedCliReport }) {
  try {
    return scenario.readReport()
  } catch {
    return null
  }
}

/**
 * The CLI records the SDK's answer to a hook callback as a control response for the request id it
 * sent. The failure names the answer that never came and the ones that did, because a timeout
 * here otherwise reads like a flake rather than a regression.
 */
async function waitForControlAnswer(
  scenario: { readReport: () => ScriptedCliReport },
  requestId: string
): Promise<ScriptedCliReport> {
  try {
    return await until(() => {
      const current = readReportSafely(scenario)
      return current?.controlResponses.some((frame) => frame.response.request_id === requestId)
        ? current
        : null
    }, `the CLI to answer the hook callback ${requestId}`)
  } catch {
    const arrived =
      readReportSafely(scenario)?.controlResponses.map((frame) => frame.response.request_id) ?? []
    throw new Error(
      `the CLI never answered the hook callback ${requestId}; the control responses that arrived: ${arrived.join(', ') || 'none'}`
    )
  }
}

function processState(pid: number): 'running' | 'exited' {
  try {
    const state = execFileSync('ps', ['-o', 'state=', '-p', String(pid)], {
      encoding: 'utf8',
      env: { ...process.env, LANG: 'C', LC_ALL: 'C' }
    }).trim()
    return state.startsWith('Z') ? 'exited' : 'running'
  } catch (error) {
    if ((error as { status?: number }).status === 1) {
      return 'exited'
    }
    throw error
  }
}

describe('Claude stream-json connection', () => {
  it('completes task Stop through the real SDK while semantic reading is paused', async () => {
    const scenario = scriptScenario([HOLD_OPEN])
    const connection = await open(launchFor(scenario))
    await connection.initializationResult()
    connection.pauseReading?.()
    await connection.stopTask('owned-shell')
    expect(scenario.readReport().controlRequests).toContainEqual(
      expect.objectContaining({
        request: expect.objectContaining({ subtype: 'stop_task', task_id: 'owned-shell' })
      })
    )
    connection.resumeReading?.()
  })

  it.runIf(process.platform !== 'win32')(
    'proves a natural SDK exit and cleans up its descendant before recovery',
    async () => {
      const scenario = scriptScenario([
        { stderr: 'claude: natural exit\n' },
        { delayMs: 500 },
        { exit: 1 }
      ])
      let exit: Error | null = null
      const connection = await open(
        {
          ...launchFor(scenario),
          env: { ...launchFor(scenario).env, ORCA_SDK_CONTRACT_DESCENDANT: '1' }
        },
        { onExit: (error) => (exit = error) }
      )
      const report = await until(() => {
        const current = readReportSafely(scenario)
        return current?.descendantPid ? current : null
      }, 'the descendant report')
      await until(() => exit, 'the natural exit error')
      try {
        await expect(connection.close()).resolves.toBe(true)
        expect(connection.exitVerdict).toEqual({ root: 'exited', tree: 'exited' })
        expect(processState(report.descendantPid as number)).toBe('exited')
      } finally {
        try {
          process.kill(report.descendantPid as number, 'SIGKILL')
        } catch {
          // Already gone.
        }
      }
    },
    20_000
  )
})

describe('Claude stream-json launch options', () => {
  // The SDK refuses a session whose CLI does not honour onFailure, so the CLI has to say it does.
  const HOOK_CAPABLE_CLI = {
    initialize: { hook_on_failure_supported: true, commands: [], models: [] }
  }

  it('registers the hooks the launch carries with the CLI', async () => {
    const scenario = scriptScenario(
      [{ awaitControlRequest: 'initialize' }, HOLD_OPEN],
      HOOK_CAPABLE_CLI
    )
    const connection = await open(launchWithGate(scenario))
    await connection.initializationResult()
    const report = await until(() => {
      const current = readReportSafely(scenario)
      const initialize = current?.controlRequests.find(
        (frame) => frame.request.subtype === 'initialize'
      )
      return initialize ? current : null
    }, 'the initialize request')
    const registered =
      report.controlRequests.find((frame) => frame.request.subtype === 'initialize')?.request.hooks
        ?.PreToolUse ?? []
    // Every matcher the launch carried is registered, none is dropped.
    expect(registered).toHaveLength(2)
    // The pattern the launch carries is the pattern the CLI receives.
    expect(registered.find((entry) => entry.matcher === 'Read')).toBeDefined()
    // The gate is the one that blocks, so another matcher cannot hide it.
    const gate = registered.find((entry) => entry.onFailure === 'block')
    expect(gate).toBeDefined()
    // The gate matches every tool, so its pattern stays absent.
    expect(gate?.matcher).toBeUndefined()
    expect(gate?.hookCallbackIds).toHaveLength(1)
  })

  // Why the extra time: this case starts the real SDK against the scripted CLI, and the SDK only
  // refuses the session after the CLI has answered the initialize request, which on a loaded
  // machine can take several seconds.
  it('refuses the session when the CLI cannot enforce a blocking hook', async () => {
    const scenario = scriptScenario([{ awaitControlRequest: 'initialize' }, HOLD_OPEN], {
      initialize: { hook_on_failure_supported: false, commands: [], models: [] }
    })
    const connection = await open(launchWithGate(scenario))
    // The backstop: without the capability the SDK refuses the session rather than run the agent
    // with a gate the CLI cannot enforce.
    await expect(connection.initializationResult()).rejects.toThrow(/does not honor onFailure/)
  }, 20_000)

  // Why the extra time: this case starts the real SDK against the scripted CLI, and the SDK only
  // refuses the session after the CLI has answered the initialize request, which on a loaded
  // machine can take several seconds.
  it('refuses the session when the CLI declares no hook capability at all', async () => {
    // A CLI that predates onFailure says nothing about the capability: its answer carries no
    // hook_on_failure_supported key, rather than saying false. The scenario states that shape here,
    // so the fixture's own default cannot change what this case exercises.
    const scenario = scriptScenario([{ awaitControlRequest: 'initialize' }, HOLD_OPEN], {
      initialize: { commands: [], models: [] }
    })
    const connection = await open(launchWithGate(scenario))
    await expect(connection.initializationResult()).rejects.toThrow(/does not honor onFailure/)
    // The CLI really answered without the capability, so the refusal is about the shape this
    // scenario declares rather than about what the fixture happens to default to.
    const answer = readReportSafely(scenario)?.controlAnswers.find(
      (entry) => entry.subtype === 'initialize'
    )?.answer
    expect(answer).toEqual({ commands: [], models: [] })
  }, 20_000)

  it('runs the hook the launch carried when the CLI asks for it', async () => {
    const scenario = scriptScenario(
      [
        { awaitControlRequest: 'initialize' },
        { delayMs: 100 },
        {
          hookCallback: {
            requestId: 'hook-1',
            toolUseId: 'tool-1',
            input: {
              hook_event_name: 'PreToolUse',
              session_id: SESSION_ID,
              transcript_path: '/work/repo/.orca/refactor/transcript.jsonl',
              cwd: '/work/repo',
              tool_name: 'Write',
              tool_input: { file_path: USER_SOURCE },
              tool_use_id: 'tool-1'
            }
          }
        },
        HOLD_OPEN
      ],
      HOOK_CAPABLE_CLI
    )
    const connection = await open(launchWithGate(scenario))
    await connection.initializationResult()
    const report = await waitForControlAnswer(scenario, 'hook-1')
    const answered = report.controlResponses.find((frame) => frame.response.request_id === 'hook-1')
    const reason = denyReason(answered?.response.response)
    // The SDK ran the launch's own hook, and it refused the write to the user's sources.
    expect(reason).toContain('Write')
    expect(reason).toContain(USER_SOURCE)
  })
})
