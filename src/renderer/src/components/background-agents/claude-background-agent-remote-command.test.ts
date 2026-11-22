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
import { isRecord } from '../../../../shared/claude-background-agents'

const ENVIRONMENT_ID = 'env-remote'
const AGENT_ID = 'aaaa1111'
/** The nonce the panel stamps on this invocation's result line. */
const NONCE = '0123456789abcdef'

/**
 * The command the host was asked to run.
 *
 * The RPC params arrive as unknown, so they are narrowed here rather than asserted at each use.
 */
function commandOf(params: unknown): string {
  return isRecord(params) && typeof params.command === 'string' ? params.command : ''
}

/**
 * Answers the host's calls the way a host that ran the command would.
 *
 * The command carries the nonce of this invocation, so the answer has to carry it too: a result
 * line of another invocation is not this one's answer.
 */
function installHost(lines: (nonce: string) => string[]): void {
  let nonce = ''
  mocks.callRuntimeRpc.mockImplementation(
    async (_target: unknown, method: string, params: unknown): Promise<unknown> => {
      if (method === 'terminal.create') {
        const command = commandOf(params)
        nonce = /ORCA_CLAUDE_RESULT_([0-9a-f]+)/.exec(command)?.[1] ?? ''
        return { terminal: { handle: 'handle-1' } }
      }
      if (method === 'terminal.read') {
        return { terminal: { tail: lines(nonce) } }
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
    expect(buildRemoteClaudeCommand('posix', ['--bg', '--', 'do it'], NONCE)).toBe(
      `claude --bg -- 'do it'; echo ORCA_CLAUDE_RESULT_${NONCE}_$?`
    )
    expect(buildRemoteClaudeCommand('powershell', ['--bg', '--', 'do it'], NONCE)).toBe(
      `& claude --bg -- 'do it'; echo ORCA_CLAUDE_RESULT_${NONCE}_$LASTEXITCODE`
    )
    expect(buildRemoteClaudeCommand('cmd', ['--bg', '--', 'do it'], NONCE)).toBe(
      `claude --bg -- "do it" & if errorlevel 1 (echo ORCA_CLAUDE_RESULT_${NONCE}_1) else (echo ORCA_CLAUDE_RESULT_${NONCE}_0)`
    )
  })

  it('keeps a prompt that carries the shell’s own characters in one argument', () => {
    expect(buildRemoteClaudeCommand('posix', ['--bg', '--', "it's two"], NONCE)).toBe(
      `claude --bg -- 'it'"'"'s two'; echo ORCA_CLAUDE_RESULT_${NONCE}_$?`
    )
  })
})

describe('starting an agent on a paired host', () => {
  it('runs the command in a terminal on that host and reports the id it printed', async () => {
    installHost((nonce) => [
      "claude --bg -- 'do it'",
      'backgrounded · cccc3333',
      `ORCA_CLAUDE_RESULT_${nonce}_0`
    ])

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
    expect(params).toMatchObject({
      // Why the floating scope: the app drops a paired host's floating inventory, so the command
      // does not appear as a second tab in this machine's tab bar.
      worktree: 'id:global-floating-terminal',
      cwd: '/w',
      startupCommandDelivery: 'fast',
      presentation: 'background'
    })
    expect(commandOf(params)).toMatch(
      /^claude --bg -- 'do it'; echo ORCA_CLAUDE_RESULT_[0-9a-f]+_\$\?$/
    )
  })

  it('pins the shell on a Windows host, so the quoted prompt means what it says', async () => {
    installHost((nonce) => ['backgrounded · cccc3333', `ORCA_CLAUDE_RESULT_${nonce}_0`])

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
    installHost((nonce) => [
      '\u001b[32m\u280b\u001b[0m backgrounded · cccc3333',
      `ORCA_CLAUDE_RESULT_${nonce}_0`
    ])

    const result = await dispatchRemoteClaudeBackgroundAgent({
      environmentId: ENVIRONMENT_ID,
      platform: 'linux',
      cwd: '/w',
      prompt: 'do it'
    })

    expect(result).toEqual({ ok: true, id: 'cccc3333' })
  })

  it('does not take a result line of another invocation for its own', async () => {
    vi.useFakeTimers()
    installHost(() => ['ORCA_CLAUDE_RESULT_ffffffffffffffff_0'])

    const pending = dispatchRemoteClaudeBackgroundAgent({
      environmentId: ENVIRONMENT_ID,
      platform: 'linux',
      cwd: '/w',
      prompt: 'do it'
    })
    // Why the clock: the panel waits for its own result line, and the forged one is not it.
    await vi.advanceTimersByTimeAsync(31_000)
    const result = await pending
    vi.useRealTimers()

    expect(result.ok).toBe(false)
  })

  it('says what the host refused, and closes the terminal it ran in', async () => {
    installHost((nonce) => [
      "claude --bg -- 'do it'",
      'Error: the model is not available',
      `ORCA_CLAUDE_RESULT_${nonce}_1`
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
    installHost((nonce) => ['claude stop aaaa1111', `ORCA_CLAUDE_RESULT_${nonce}_0`])

    const result = await runRemoteClaudeAgentCommand({
      environmentId: ENVIRONMENT_ID,
      platform: 'linux',
      verb: 'stop',
      agentId: AGENT_ID
    })

    expect(result).toEqual({ ok: true, id: AGENT_ID })
    const [, , params] = mocks.callRuntimeRpc.mock.calls[0]
    expect(commandOf(params)).toMatch(
      /^claude stop aaaa1111; echo ORCA_CLAUDE_RESULT_[0-9a-f]+_\$\?$/
    )
  })

  it('refuses an id that is not the CLI’s own, before it reaches the host', async () => {
    installHost(() => [])

    const result = await runRemoteClaudeAgentCommand({
      environmentId: ENVIRONMENT_ID,
      platform: 'linux',
      verb: 'rm',
      agentId: 'aaaa1111 & calc'
    })

    expect(result).toEqual({ ok: false, message: 'not a background agent id' })
    expect(mocks.callRuntimeRpc).not.toHaveBeenCalled()
  })

  it('reports a command the host refused', async () => {
    installHost((nonce) => ['claude rm aaaa1111', 'no such agent', `ORCA_CLAUDE_RESULT_${nonce}_1`])

    const result = await runRemoteClaudeAgentCommand({
      environmentId: ENVIRONMENT_ID,
      platform: 'linux',
      verb: 'rm',
      agentId: AGENT_ID
    })

    expect(result).toEqual({ ok: false, message: 'no such agent' })
  })
})
