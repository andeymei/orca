import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  callRuntimeRpc: vi.fn()
}))

vi.mock('@/runtime/rpc/calls/runtime-rpc-call', () => ({
  callRuntimeRpc: mocks.callRuntimeRpc
}))

import {
  closeRemoteBackgroundAgentTerminal,
  createRemoteBackgroundAgentTerminal
} from './claude-background-agent-remote-terminal'
import { resetHostPlatformsForTests } from './background-agent-host-platform'

const ENVIRONMENT_ID = 'env-remote'
const AGENT_ID = 'aaaa1111'
const WINDOWS_CWD = 'D:\\ctjt\\code\\ctjt-platform\\ctjt-service'

/** The creates the panel made, oldest first: the platform probe, then the attach. */
function terminalCreates(): unknown[][] {
  return mocks.callRuntimeRpc.mock.calls.filter((call) => call[1] === 'terminal.create')
}

/** Answers the probe with a platform and the attach with the terminal the panel asked for. */
function installHost(attach: { handle?: string }): void {
  let probeAnswered = false
  mocks.callRuntimeRpc.mockImplementation(
    async (_target: unknown, method: string): Promise<unknown> => {
      if (method !== 'terminal.create') {
        return undefined
      }
      if (!probeAnswered) {
        probeAnswered = true
        return { terminal: { handle: 'probe-1', hostPlatform: 'win32' } }
      }
      return { terminal: attach }
    }
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  resetHostPlatformsForTests()
})

describe('the terminal that shows a paired host’s agent', () => {
  it('asks the host to attach to the agent and previews that host’s terminal', async () => {
    installHost({ handle: 'handle-1' })

    const terminal = await createRemoteBackgroundAgentTerminal({
      environmentId: ENVIRONMENT_ID,
      agentId: AGENT_ID,
      cwd: WINDOWS_CWD
    })

    // Why two creates: the first asks the host what it runs, the second runs the attach.
    const creates = terminalCreates()
    expect(creates).toHaveLength(2)
    const [target, method, params] = creates[1]
    expect(target).toEqual({ kind: 'environment', environmentId: ENVIRONMENT_ID })
    expect(method).toBe('terminal.create')
    expect(params).toEqual({
      // Why the floating scope: the app drops a paired host's floating inventory, so the agent
      // does not appear as a second tab in this machine's tab bar.
      worktree: 'id:global-floating-terminal',
      command: "claude attach 'aaaa1111'",
      cwd: WINDOWS_CWD,
      // Why the pinned shell: the command is quoted for one shell, and the host is the only one
      // that knows which shell it runs.
      shell: 'powershell.exe',
      startupCommandDelivery: 'fast',
      presentation: 'background'
    })
    expect(terminal).toEqual({ ptyId: 'remote:env-remote@@handle-1', handle: 'handle-1' })
  })

  it('refuses a host that returns no terminal handle', async () => {
    installHost({})

    await expect(
      createRemoteBackgroundAgentTerminal({
        environmentId: ENVIRONMENT_ID,
        agentId: AGENT_ID,
        cwd: null
      })
    ).rejects.toThrow('the paired host did not return a terminal handle')
  })

  it('refuses a host that does not report its platform, rather than guessing one', async () => {
    mocks.callRuntimeRpc.mockResolvedValue({ terminal: { handle: 'probe-1' } })

    await expect(
      createRemoteBackgroundAgentTerminal({
        environmentId: ENVIRONMENT_ID,
        agentId: AGENT_ID,
        cwd: null
      })
    ).rejects.toThrow('the host does not report its platform')
    // Why one create: the attach never runs, so the host is never asked to run the command.
    expect(terminalCreates()).toHaveLength(1)
  })

  it('closes the host’s terminal again, which leaves the agent running', async () => {
    mocks.callRuntimeRpc.mockResolvedValue({
      terminal: { handle: 'handle-1', hostPlatform: 'win32' }
    })

    await closeRemoteBackgroundAgentTerminal({
      environmentId: ENVIRONMENT_ID,
      handle: 'handle-1'
    })

    expect(mocks.callRuntimeRpc).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: ENVIRONMENT_ID },
      'terminal.close',
      { terminal: 'handle-1' },
      { timeoutMs: 15_000 }
    )
  })
})
