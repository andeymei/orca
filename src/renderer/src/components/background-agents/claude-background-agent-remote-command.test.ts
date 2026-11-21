import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  callRuntimeRpc: vi.fn()
}))

vi.mock('@/runtime/rpc/calls/runtime-rpc-call', () => ({
  callRuntimeRpc: mocks.callRuntimeRpc
}))

import {
  buildRemoteClaudeCommand,
  dispatchRemoteClaudeBackgroundAgent,
  runRemoteClaudeAgentCommand
} from './claude-background-agent-remote-command'

const ENVIRONMENT_ID = 'env-remote'
const AGENT_ID = 'aaaa1111'

/** The lines the host's terminal holds while the command runs, and after it ends. */
function terminalWith(lines: string[]): { terminal: { handle: string; tail: string[] } } {
  return { terminal: { handle: 'handle-1', tail: lines } }
}

/** Answers the host's calls the way a host that ran the command would. */
function installHost(lines: string[]): void {
  mocks.callRuntimeRpc.mockImplementation(
    async (_target: unknown, method: string): Promise<unknown> => {
      if (method === 'terminal.create') {
        return { terminal: { handle: 'handle-1' } }
      }
      if (method === 'terminal.read') {
        return terminalWith(lines)
      }
      return undefined
    }
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('the command a paired host runs', () => {
  it('quotes the prompt for the shell the host runs it in', () => {
    expect(buildRemoteClaudeCommand('posix', ['--bg', '--', 'do it'])).toBe(
      "claude --bg -- 'do it'; echo ORCA_CLAUDE_RESULT_$?"
    )
    expect(buildRemoteClaudeCommand('powershell', ['--bg', '--', 'do it'])).toBe(
      "& claude --bg -- 'do it'; echo ORCA_CLAUDE_RESULT_$LASTEXITCODE"
    )
    expect(buildRemoteClaudeCommand('cmd', ['--bg', '--', 'do it'])).toBe(
      'claude --bg -- "do it" & if errorlevel 1 (echo ORCA_CLAUDE_RESULT_1) else (echo ORCA_CLAUDE_RESULT_0)'
    )
  })

  it('keeps a prompt that carries the shell’s own characters in one argument', () => {
    expect(buildRemoteClaudeCommand('posix', ['--bg', '--', "it's two"])).toBe(
      `claude --bg -- 'it'"'"'s two'; echo ORCA_CLAUDE_RESULT_$?`
    )
  })
})

describe('starting an agent on a paired host', () => {
  it('runs the command in a terminal on that host and reports the id it printed', async () => {
    installHost(["claude --bg -- 'do it'", 'backgrounded · cccc3333', 'ORCA_CLAUDE_RESULT_0'])

    const result = await dispatchRemoteClaudeBackgroundAgent({
      environmentId: ENVIRONMENT_ID,
      platform: 'linux',
      cwd: '/w',
      prompt: 'do it'
    })

    expect(result).toEqual({ ok: true, id: 'cccc3333' })
    const [target, method, params] = mocks.callRuntimeRpc.mock.calls[0]
    expect(target).toEqual({ kind: 'environment', environmentId: ENVIRONMENT_ID })
    expect(method).toBe('terminal.create')
    expect(params).toEqual({
      // Why the floating scope: the app drops a paired host's floating inventory, so the command
      // does not appear as a second tab in this machine's tab bar.
      worktree: 'id:global-floating-terminal',
      command: "claude --bg -- 'do it'; echo ORCA_CLAUDE_RESULT_$?",
      cwd: '/w',
      startupCommandDelivery: 'fast',
      presentation: 'background'
    })
  })

  it('pins the shell on a Windows host, so the quoted prompt means what it says', async () => {
    installHost(['backgrounded · cccc3333', 'ORCA_CLAUDE_RESULT_0'])

    await dispatchRemoteClaudeBackgroundAgent({
      environmentId: ENVIRONMENT_ID,
      platform: 'win32',
      cwd: 'D:\\ctjt\\code',
      prompt: 'do it'
    })

    const [, , params] = mocks.callRuntimeRpc.mock.calls[0]
    expect(params).toMatchObject({ shell: 'powershell.exe' })
  })

  it('reads the id out of a line the terminal redrew', async () => {
    installHost(['\u001b[32m⠋\u001b[0m backgrounded · cccc3333', 'ORCA_CLAUDE_RESULT_0'])

    const result = await dispatchRemoteClaudeBackgroundAgent({
      environmentId: ENVIRONMENT_ID,
      platform: 'linux',
      cwd: '/w',
      prompt: 'do it'
    })

    expect(result).toEqual({ ok: true, id: 'cccc3333' })
  })

  it('says what the host refused, and closes the terminal it ran in', async () => {
    installHost([
      "claude --bg -- 'do it'",
      'Error: the model is not available',
      'ORCA_CLAUDE_RESULT_1'
    ])

    const result = await dispatchRemoteClaudeBackgroundAgent({
      environmentId: ENVIRONMENT_ID,
      platform: 'linux',
      cwd: '/w',
      prompt: 'do it'
    })

    expect(result).toEqual({ ok: false, message: 'Error: the model is not available' })
    expect(mocks.callRuntimeRpc).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: ENVIRONMENT_ID },
      'terminal.close',
      { terminal: 'handle-1' },
      { timeoutMs: 15_000 }
    )
  })
})

describe('commanding an agent on a paired host', () => {
  it('stops the agent the host owns', async () => {
    installHost(['claude stop aaaa1111', 'ORCA_CLAUDE_RESULT_0'])

    const result = await runRemoteClaudeAgentCommand({
      environmentId: ENVIRONMENT_ID,
      platform: 'linux',
      verb: 'stop',
      agentId: AGENT_ID
    })

    expect(result).toEqual({ ok: true, id: AGENT_ID })
    const [, , params] = mocks.callRuntimeRpc.mock.calls[0]
    expect(params).toMatchObject({
      command: 'claude stop aaaa1111; echo ORCA_CLAUDE_RESULT_$?'
    })
  })

  it('reports a command the host refused', async () => {
    installHost(['claude rm aaaa1111', 'no such agent', 'ORCA_CLAUDE_RESULT_1'])

    const result = await runRemoteClaudeAgentCommand({
      environmentId: ENVIRONMENT_ID,
      platform: 'linux',
      verb: 'rm',
      agentId: AGENT_ID
    })

    expect(result).toEqual({ ok: false, message: 'no such agent' })
  })
})
