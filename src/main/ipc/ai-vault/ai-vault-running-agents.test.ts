import { expect, it, vi } from 'vitest'
import { listRunningAgentsForHost, type RunningAgentSource } from './ai-vault-running-agents'

const LOCAL_AGENT = {
  id: 'aaaa1111',
  sessionId: 'aaaa1111-2222-3333-4444-555566667777',
  name: 'local agent',
  cwd: '/Users/mac/ctjt/test/aieditor'
}

function createSource(): {
  source: RunningAgentSource
  listLocalAgents: ReturnType<typeof vi.fn>
  listRuntimeAgents: ReturnType<typeof vi.fn>
} {
  const listLocalAgents = vi.fn(async () => [LOCAL_AGENT])
  const listRuntimeAgents = vi.fn(async () => [
    { ...LOCAL_AGENT, id: 'bbbb2222', sessionId: 'bbbb2222-3333-4444-5555-666677778888' }
  ])
  return { source: { listLocalAgents, listRuntimeAgents }, listLocalAgents, listRuntimeAgents }
}

it('asks this machine for a conversation that runs here', async () => {
  const { source, listLocalAgents, listRuntimeAgents } = createSource()
  await expect(listRunningAgentsForHost('local', source)).resolves.toEqual([LOCAL_AGENT])
  await expect(listRunningAgentsForHost(undefined, source)).resolves.toEqual([LOCAL_AGENT])
  expect(listLocalAgents).toHaveBeenCalledTimes(2)
  expect(listRuntimeAgents).not.toHaveBeenCalled()
})

it('asks the paired host that runs the conversation', async () => {
  const { source, listLocalAgents, listRuntimeAgents } = createSource()
  const remote = await listRunningAgentsForHost('runtime:env-1', source)
  expect(remote).toHaveLength(1)
  expect(listRuntimeAgents).toHaveBeenCalledWith('env-1')
  expect(listLocalAgents).not.toHaveBeenCalled()
})

it('reports nothing for a host that runs no conversations Orca can open', async () => {
  const { source, listLocalAgents, listRuntimeAgents } = createSource()
  await expect(listRunningAgentsForHost('ssh:host-1', source)).resolves.toEqual([])
  expect(listLocalAgents).not.toHaveBeenCalled()
  expect(listRuntimeAgents).not.toHaveBeenCalled()
})
