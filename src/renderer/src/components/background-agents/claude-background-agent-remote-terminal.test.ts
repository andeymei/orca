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

const ENVIRONMENT_ID = 'env-remote'
const AGENT_ID = 'aaaa1111'
const WINDOWS_CWD = 'D:\\ctjt\\code\\ctjt-platform\\ctjt-service'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('the terminal that shows a paired host’s agent', () => {
  it('asks the host to attach to the agent and previews that host’s terminal', async () => {
    mocks.callRuntimeRpc.mockResolvedValue({ terminal: { handle: 'handle-1' } })

    const terminal = await createRemoteBackgroundAgentTerminal({
      environmentId: ENVIRONMENT_ID,
      agentId: AGENT_ID,
      cwd: WINDOWS_CWD
    })

    expect(mocks.callRuntimeRpc).toHaveBeenCalledTimes(1)
    const [target, method, params] = mocks.callRuntimeRpc.mock.calls[0]
    expect(target).toEqual({ kind: 'environment', environmentId: ENVIRONMENT_ID })
    expect(method).toBe('terminal.create')
    expect(params).toEqual({
      // Why the floating scope: the app drops a paired host's floating inventory, so the agent
      // does not appear as a second tab in this machine's tab bar.
      worktree: 'id:global-floating-terminal',
      command: "claude attach 'aaaa1111'",
      cwd: WINDOWS_CWD,
      startupCommandDelivery: 'fast',
      presentation: 'background'
    })
    expect(terminal).toEqual({ ptyId: 'remote:env-remote@@handle-1', handle: 'handle-1' })
  })

  it('refuses a host that returns no terminal handle', async () => {
    mocks.callRuntimeRpc.mockResolvedValue({ terminal: {} })

    await expect(
      createRemoteBackgroundAgentTerminal({
        environmentId: ENVIRONMENT_ID,
        agentId: AGENT_ID,
        cwd: null
      })
    ).rejects.toThrow('the paired host did not return a terminal handle')
  })

  it('closes the host’s terminal again, which leaves the agent running', async () => {
    mocks.callRuntimeRpc.mockResolvedValue(undefined)

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
