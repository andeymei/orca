import { beforeEach, describe, expect, it, vi } from 'vitest'

const callRuntimeEnvironment = vi.hoisted(() => vi.fn())
vi.mock('../ipc/runtime-environments/runtime-environment-transport-routing', () => ({
  callRuntimeEnvironment
}))

import { listRuntimeClaudeBackgroundAgents } from './runtime-claude-background-agents'

beforeEach(() => {
  callRuntimeEnvironment.mockReset()
})

describe('the agents a paired runtime host runs', () => {
  it('asks the host for the agents it runs and reads the answer', async () => {
    callRuntimeEnvironment.mockResolvedValue({
      ok: true,
      result: [{ id: '8857ad86', sessionId: 'session-1', name: 'agent', cwd: '/repos/app' }]
    })
    const agents = await listRuntimeClaudeBackgroundAgents('/userData', 'env-1')
    expect(callRuntimeEnvironment).toHaveBeenCalledWith(
      '/userData',
      'env-1',
      'aiVault.listRunningAgents',
      {},
      expect.any(Number)
    )
    expect(agents?.[0]?.id).toBe('8857ad86')
  })

  it('reports a host that cannot answer as unknown rather than as running nothing', async () => {
    callRuntimeEnvironment.mockResolvedValue({
      ok: false,
      error: { code: 'method_not_found', message: 'unknown method' }
    })
    expect(await listRuntimeClaudeBackgroundAgents('/userData', 'env-1')).toBeNull()
  })
})
