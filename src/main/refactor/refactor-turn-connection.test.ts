import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  HookCallback,
  HookCallbackMatcher,
  HookInput,
  HookJSONOutput
} from '@anthropic-ai/claude-agent-sdk'
import type { ClaudeStreamJsonConnectionHandlers } from '../claude/claude-stream-json-connection'
import { runRefactorTurn, type RefactorTurnResult } from './refactor-runner'
import type { RefactorAgentLaunch } from './refactor-agent-launch'
import {
  closeRefactorTurnConnection,
  type RefactorTurnConnection,
  type RefactorTurnConnectionFactory
} from './refactor-turn-connection'

function launchFor(workspaceRoot: string): RefactorAgentLaunch {
  return {
    pathToClaudeCodeExecutable: '/usr/bin/claude',
    env: {},
    cwd: workspaceRoot,
    options: { permissionMode: 'default', allowedTools: [], disallowedTools: ['Bash'] }
  }
}

async function makeWorkspace(): Promise<{ workspaceRoot: string; scratchRoot: string }> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'orca-refactor-turn-'))
  const scratchRoot = path.join(workspaceRoot, '.orca', 'refactor', 'job-1')
  await mkdir(scratchRoot, { recursive: true })
  await writeFile(
    path.join(scratchRoot, 'manifest.json'),
    JSON.stringify({
      proposals: [{ id: 'p1', title: '抽出校验', rationale: '重复了两遍', files: ['src/foo.ts'] }]
    }),
    'utf8'
  )
  return { workspaceRoot, scratchRoot }
}

function connectionFactory(input: {
  onOpen?: (launch: RefactorAgentLaunch, handlers: ClaudeStreamJsonConnectionHandlers) => void
  onSend: (handlers: ClaudeStreamJsonConnectionHandlers) => void
  close: () => Promise<boolean>
  exitVerdict?: { root: string; tree: string }
}): RefactorTurnConnectionFactory {
  return async (launch, handlers) => {
    input.onOpen?.(launch, handlers)
    return {
      send: async () => {
        input.onSend(handlers)
      },
      close: input.close,
      exitVerdict: input.exitVerdict
    }
  }
}

function runTurn(input: {
  launch: RefactorAgentLaunch
  scratchRoot: string
  workspaceRoot: string
  openConnection?: RefactorTurnConnectionFactory
  signal?: AbortSignal
}): Promise<RefactorTurnResult> {
  return runRefactorTurn({
    launch: input.launch,
    scratchRoot: input.scratchRoot,
    workspaceRoot: input.workspaceRoot,
    prompt: { system: 'system', user: 'user' },
    signal: input.signal ?? new AbortController().signal,
    openConnection: input.openConnection
  })
}

function preToolUseInput(cwd: string, toolName: string, toolInput: unknown): HookInput {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 'session-1',
    transcript_path: path.join(cwd, '.orca', 'refactor', 'transcript.jsonl'),
    cwd,
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: 'tool-1'
  }
}

/** The reason the hook denied the call, or null when it let the call through. */
async function hookReason(
  matcher: HookCallbackMatcher,
  cwd: string,
  toolName: string,
  toolInput: unknown
): Promise<string | null> {
  const output = await matcher.hooks[0](preToolUseInput(cwd, toolName, toolInput), undefined, {
    signal: new AbortController().signal
  })
  if (!('hookSpecificOutput' in output)) {
    return null
  }
  const specific = output.hookSpecificOutput
  if (
    !specific ||
    specific.hookEventName !== 'PreToolUse' ||
    specific.permissionDecision !== 'deny'
  ) {
    return null
  }
  return specific.permissionDecisionReason ?? ''
}

/**
 * The gate's matcher: the runner appends it after every matcher the launch already carried, so it
 * is the last one in the list, and it refuses a write to the user's own sources naming the tool
 * and the path. A launch-side policy hook in front of it cannot be mistaken for the gate.
 */
async function findGateMatcher(
  matchers: HookCallbackMatcher[],
  workspaceRoot: string
): Promise<HookCallbackMatcher | null> {
  const gate = matchers.at(-1)
  if (!gate) {
    return null
  }
  const sourcePath = path.join(workspaceRoot, 'src', 'foo.ts')
  const refusal = await hookReason(gate, workspaceRoot, 'Write', { file_path: sourcePath })
  if (refusal === null || !refusal.includes('Write') || !refusal.includes(sourcePath)) {
    return null
  }
  return gate
}

const successFrame = { type: 'result', subtype: 'success', is_error: false }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A launch-side policy hook that denies the same write the gate denies, without being the gate:
 * it does not block on failure and it does not name the scratch root.
 */
const policyHook: HookCallback = async (input: HookInput): Promise<HookJSONOutput> => {
  if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Write') {
    return {}
  }
  const toolInput = input.tool_input
  const target = isRecord(toolInput) ? String(toolInput.file_path ?? '') : ''
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Write is not allowed in this task; the refused path: ${target}`
    }
  }
}

describe('closeRefactorTurnConnection', () => {
  const connection = (close: () => Promise<boolean>): RefactorTurnConnection => ({
    send: async () => {},
    close
  })

  it('says nothing when the child is proven gone', async () => {
    expect(await closeRefactorTurnConnection(connection(async () => true))).toEqual([])
  })

  it('warns when the close does not prove the child exited', async () => {
    const warnings = await closeRefactorTurnConnection({
      ...connection(async () => false),
      exitVerdict: { root: 'live', tree: 'live' }
    })
    expect(warnings.join('\n')).toContain('The child process did not confirm that it exited')
    expect(warnings.join('\n')).toContain('The root process did not exit: live')
  })

  it('turns a throwing close into a warning instead of letting it escape', async () => {
    const warnings = await closeRefactorTurnConnection(
      connection(async () => {
        throw new Error('the connection refused to close')
      })
    )
    expect(warnings.join('\n')).toContain(
      'The connection could not be closed: the connection refused to close'
    )
  })
})

describe('runRefactorTurn', () => {
  it('keeps the verdict when the connection refuses to close', async () => {
    const { workspaceRoot, scratchRoot } = await makeWorkspace()
    const turn = await runTurn({
      launch: launchFor(workspaceRoot),
      scratchRoot,
      workspaceRoot,
      openConnection: connectionFactory({
        onSend: (handlers) => handlers.onMessage?.(successFrame),
        close: async () => {
          throw new Error('the connection refused to close')
        }
      })
    })
    expect(turn.state).toBe('done')
    expect(turn.manifest?.proposals.map((proposal) => proposal.id)).toEqual(['p1'])
    expect(turn.warnings.join('\n')).toContain(
      'The connection could not be closed: the connection refused to close'
    )
  })

  it('keeps the verdict when the close cannot prove the child exited', async () => {
    const { workspaceRoot, scratchRoot } = await makeWorkspace()
    const turn = await runTurn({
      launch: launchFor(workspaceRoot),
      scratchRoot,
      workspaceRoot,
      openConnection: connectionFactory({
        onSend: (handlers) => handlers.onMessage?.(successFrame),
        close: async () => false,
        exitVerdict: { root: 'live', tree: 'live' }
      })
    })
    expect(turn.state).toBe('done')
    expect(turn.warnings.join('\n')).toContain('The child process did not confirm that it exited')
  })

  it('drives the refusal path when the CLI refuses the hook that keeps the gate', async () => {
    const { workspaceRoot, scratchRoot } = await makeWorkspace()
    const turn = await runTurn({
      launch: launchFor(workspaceRoot),
      scratchRoot,
      workspaceRoot,
      openConnection: connectionFactory({
        onSend: (handlers) =>
          handlers.onFault?.(
            new Error('claude stream-json exited', {
              cause: new Error(
                'The process answering initialize does not honor onFailure on hook matchers'
              )
            })
          ),
        close: async () => true
      })
    })
    expect(turn.state).toBe('failed')
    expect(turn.warnings.join('\n')).toContain('does not honor onFailure on hook matchers')
  })

  it('hands the connection a launch that carries the gate hook', async () => {
    const { workspaceRoot, scratchRoot } = await makeWorkspace()
    const captured: RefactorAgentLaunch[] = []
    await runTurn({
      launch: launchFor(workspaceRoot),
      scratchRoot,
      workspaceRoot,
      openConnection: connectionFactory({
        onOpen: (launch) => captured.push(launch),
        onSend: (handlers) => handlers.onMessage?.(successFrame),
        close: async () => true
      })
    })
    const matchers = captured[0].options.hooks?.PreToolUse ?? []
    const gate = await findGateMatcher(matchers, workspaceRoot)
    if (!gate) {
      throw new Error("the launch carries no matcher that refuses a write to the user's sources")
    }
    expect(gate.onFailure).toBe('block')
    // The attached hook is the gate: it refuses a write to the user's own sources.
    const reason = await hookReason(gate, workspaceRoot, 'Write', {
      file_path: path.join(workspaceRoot, 'src', 'foo.ts')
    })
    expect(reason).toContain('Write')
    expect(reason).toContain(path.join(workspaceRoot, 'src', 'foo.ts'))
    // The gate's own reason names the scratch root, so a policy hook cannot pass for it.
    expect(reason).toContain(scratchRoot)
  })

  it('keeps a matcher the launch already carried beside the gate', async () => {
    const { workspaceRoot, scratchRoot } = await makeWorkspace()
    const captured: RefactorAgentLaunch[] = []
    const launch = launchFor(workspaceRoot)
    launch.options.hooks = {
      PreToolUse: [{ matcher: 'Read', hooks: [async () => ({})] }]
    }
    await runTurn({
      launch,
      scratchRoot,
      workspaceRoot,
      openConnection: connectionFactory({
        onOpen: (openLaunch) => captured.push(openLaunch),
        onSend: (handlers) => handlers.onMessage?.(successFrame),
        close: async () => true
      })
    })
    const matchers = captured[0].options.hooks?.PreToolUse ?? []
    expect(matchers).toHaveLength(2)
    const gate = await findGateMatcher(matchers, workspaceRoot)
    if (!gate) {
      throw new Error("the launch carries no matcher that refuses a write to the user's sources")
    }
    expect(gate.onFailure).toBe('block')
  })

  it('finds the gate behind a launch-side policy hook that denies the same write', async () => {
    const { workspaceRoot, scratchRoot } = await makeWorkspace()
    const captured: RefactorAgentLaunch[] = []
    const launch = launchFor(workspaceRoot)
    launch.options.hooks = {
      PreToolUse: [{ matcher: 'Write', hooks: [policyHook] }]
    }
    await runTurn({
      launch,
      scratchRoot,
      workspaceRoot,
      openConnection: connectionFactory({
        onOpen: (openLaunch) => captured.push(openLaunch),
        onSend: (handlers) => handlers.onMessage?.(successFrame),
        close: async () => true
      })
    })
    const matchers = captured[0].options.hooks?.PreToolUse ?? []
    expect(matchers).toHaveLength(2)
    // The policy hook denies the same write, but the gate is the one the runner appended.
    const gate = await findGateMatcher(matchers, workspaceRoot)
    if (!gate) {
      throw new Error("the launch carries no matcher that refuses a write to the user's sources")
    }
    expect(gate.onFailure).toBe('block')
  })

  it('gives the gate and the hook the workspace-relative scratch root', async () => {
    const { workspaceRoot, scratchRoot } = await makeWorkspace()
    const captured: RefactorAgentLaunch[] = []
    const capturedHandlers: ClaudeStreamJsonConnectionHandlers[] = []
    const signal = new AbortController().signal
    const turn = await runTurn({
      launch: launchFor(workspaceRoot),
      scratchRoot: path.relative(workspaceRoot, scratchRoot),
      workspaceRoot,
      signal,
      openConnection: connectionFactory({
        onOpen: (launch, handlers) => {
          captured.push(launch)
          capturedHandlers.push(handlers)
        },
        onSend: (handlers) => handlers.onMessage?.(successFrame),
        close: async () => true
      })
    })
    const proposalPath = path.join(scratchRoot, 'p1', 'src', 'foo.ts')
    const matchers = captured[0].options.hooks?.PreToolUse ?? []
    const gate = await findGateMatcher(matchers, workspaceRoot)
    if (!gate) {
      throw new Error("the launch carries no matcher that refuses a write to the user's sources")
    }
    // The hook writes into the scratch tree: its root is the workspace-relative one, not the process's.
    expect(await hookReason(gate, workspaceRoot, 'Write', { file_path: proposalPath })).toBeNull()
    // The second layer decides on the same root.
    const verdict = await capturedHandlers[0].canUseTool?.(
      'Write',
      { file_path: proposalPath },
      { signal, toolUseID: 'tool-1', requestId: 'request-1' }
    )
    expect(verdict?.behavior).toBe('allow')
    // And the manifest is read from that same tree.
    expect(turn.manifest?.proposals.map((proposal) => proposal.id)).toEqual(['p1'])
  })

  it('denies a write outside the scratch root with a reason the agent can act on', async () => {
    const { workspaceRoot, scratchRoot } = await makeWorkspace()
    const capturedHandlers: ClaudeStreamJsonConnectionHandlers[] = []
    const signal = new AbortController().signal
    await runTurn({
      launch: launchFor(workspaceRoot),
      scratchRoot,
      workspaceRoot,
      signal,
      openConnection: connectionFactory({
        onOpen: (_launch, handlers) => capturedHandlers.push(handlers),
        onSend: (handlers) => handlers.onMessage?.(successFrame),
        close: async () => true
      })
    })
    const sourcePath = path.join(workspaceRoot, 'src', 'foo.ts')
    const verdict = await capturedHandlers[0].canUseTool?.(
      'Write',
      { file_path: sourcePath },
      { signal, toolUseID: 'tool-1', requestId: 'request-1' }
    )
    if (verdict?.behavior !== 'deny') {
      throw new Error('the second layer did not deny the write')
    }
    expect(verdict.message).toContain('Write')
    expect(verdict.message).toContain(sourcePath)
    expect(verdict.message).toContain(scratchRoot)
  })

  it('refuses a launch whose permission mode would skip the gate', async () => {
    const { workspaceRoot, scratchRoot } = await makeWorkspace()
    const launch = launchFor(workspaceRoot)
    launch.options.permissionMode = 'bypassPermissions'
    await expect(runTurn({ launch, scratchRoot, workspaceRoot })).rejects.toThrow(/permission mode/)
  })

  it('refuses a launch that auto-approves a bare tool name', async () => {
    const { workspaceRoot, scratchRoot } = await makeWorkspace()
    const launch = launchFor(workspaceRoot)
    launch.options.allowedTools = ['Write']
    await expect(runTurn({ launch, scratchRoot, workspaceRoot })).rejects.toThrow(/bare tools/)
  })

  it('refuses a workspace root that is not the agent cwd', async () => {
    const { workspaceRoot, scratchRoot } = await makeWorkspace()
    const otherRoot = await mkdtemp(path.join(tmpdir(), 'orca-refactor-other-'))
    await expect(
      runTurn({ launch: launchFor(otherRoot), scratchRoot, workspaceRoot })
    ).rejects.toThrow(/workspace root/)
  })

  it('refuses a scratch root that is the workspace root itself', async () => {
    const { workspaceRoot } = await makeWorkspace()
    await expect(
      runTurn({
        launch: launchFor(workspaceRoot),
        scratchRoot: workspaceRoot,
        workspaceRoot
      })
    ).rejects.toThrow(/not strictly inside/)
  })
})
