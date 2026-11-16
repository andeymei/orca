import { expect, it } from 'vitest'
import { createTestStore } from '../../testing/app-store-test-fixture'

it('keeps the previous agents and their activity lines while a slow refresh runs', () => {
  const store = createTestStore()
  store.getState().publishBackgroundAgentsListing({
    status: 'ready',
    agents: [{ id: 'aaaa1111', sessionId: 's', name: 'bg', cwd: '/w', state: 'working' }],
    details: {},
    message: null
  })
  store.getState().publishBackgroundAgentDetails({
    aaaa1111: { detail: 'now doing X', needs: null, updatedAt: 7 }
  })
  // A refresh that fails must not empty the list, nor the gray line under the agent's name.
  store.getState().publishBackgroundAgentsListing({
    status: 'error',
    agents: [],
    details: {},
    message: 'the CLI timed out'
  })
  expect(store.getState().backgroundAgentsAgents).toHaveLength(1)
  expect(store.getState().backgroundAgentsDetails.aaaa1111.detail).toBe('now doing X')
  expect(store.getState().backgroundAgentsStatus).toBe('error')
  expect(store.getState().backgroundAgentsMessage).toBe('the CLI timed out')
})

it('empties the agents and the details when the machine has no Claude Code CLI at all', () => {
  const store = createTestStore()
  store.getState().publishBackgroundAgentsListing({
    status: 'ready',
    agents: [{ id: 'aaaa1111', sessionId: 's', name: 'bg', cwd: '/w', state: 'working' }],
    details: {},
    message: null
  })
  store.getState().publishBackgroundAgentDetails({
    aaaa1111: { detail: 'now doing X', needs: null, updatedAt: 7 }
  })
  store.getState().publishBackgroundAgentsListing({
    status: 'unsupported',
    agents: [],
    details: {},
    message: null
  })
  expect(store.getState().backgroundAgentsAgents).toHaveLength(0)
  expect(store.getState().backgroundAgentsDetails).toEqual({})
  expect(store.getState().backgroundAgentsStatus).toBe('unsupported')
})

it('merges the details without touching the agents', () => {
  const store = createTestStore()
  store.getState().publishBackgroundAgentsListing({
    status: 'ready',
    agents: [{ id: 'aaaa1111', sessionId: 's', name: 'bg', cwd: '/w', state: 'working' }],
    details: {},
    message: null
  })
  store.getState().publishBackgroundAgentDetails({
    aaaa1111: { detail: 'now doing X', needs: null, updatedAt: 7 }
  })
  // One unreadable state file must not wipe the line of every other agent.
  store.getState().publishBackgroundAgentDetails({
    bbbb2222: { detail: 'now doing Y', needs: null, updatedAt: 8 }
  })
  expect(store.getState().backgroundAgentsDetails.aaaa1111.detail).toBe('now doing X')
  expect(store.getState().backgroundAgentsDetails.bbbb2222.detail).toBe('now doing Y')
  expect(store.getState().backgroundAgentsAgents).toHaveLength(1)
})

it('replaces the roster and the details when a refresh succeeds', () => {
  const store = createTestStore()
  store.getState().publishBackgroundAgentsListing({
    status: 'ready',
    agents: [
      { id: 'aaaa1111', sessionId: 's', name: 'bg', cwd: '/w', state: 'working' },
      { id: 'bbbb2222', sessionId: 't', name: 'bg2', cwd: '/w', state: 'working' }
    ],
    details: { aaaa1111: { detail: 'now doing X', needs: null, updatedAt: 7 } },
    message: null
  })
  // The listing is authoritative: an agent the CLI dropped leaves the roster and its line.
  store.getState().publishBackgroundAgentsListing({
    status: 'ready',
    agents: [{ id: 'bbbb2222', sessionId: 't', name: 'bg2', cwd: '/w', state: 'working' }],
    details: { bbbb2222: { detail: 'now doing Y', needs: null, updatedAt: 8 } },
    message: null
  })
  expect(store.getState().backgroundAgentsAgents).toHaveLength(1)
  expect(store.getState().backgroundAgentsAgents[0].id).toBe('bbbb2222')
  expect(Object.keys(store.getState().backgroundAgentsDetails)).toEqual(['bbbb2222'])
})

it('opens and closes an agent', () => {
  const store = createTestStore()
  store.getState().openBackgroundAgent('aaaa1111')
  expect(store.getState().backgroundAgentsScreen).toEqual({ kind: 'agent', agentId: 'aaaa1111' })
  store.getState().closeBackgroundAgent()
  expect(store.getState().backgroundAgentsScreen).toEqual({ kind: 'list' })
})

it('keeps the dispatch placeholder row until the panel clears it', () => {
  const store = createTestStore()
  // The panel unmounts when the user switches sidebar tabs, so the placeholder lives in the store.
  store
    .getState()
    .publishBackgroundAgentsDispatch({ state: 'opening', agentId: null, message: null })
  expect(store.getState().backgroundAgentsDispatch).toEqual({
    state: 'opening',
    agentId: null,
    message: null
  })
  store
    .getState()
    .publishBackgroundAgentsDispatch({ state: 'started', agentId: 'bbbb2222', message: null })
  expect(store.getState().backgroundAgentsDispatch?.agentId).toBe('bbbb2222')
  store.getState().publishBackgroundAgentsDispatch(null)
  expect(store.getState().backgroundAgentsDispatch).toBeNull()
})
