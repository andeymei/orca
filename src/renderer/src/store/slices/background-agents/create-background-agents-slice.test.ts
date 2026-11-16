import { expect, it } from 'vitest'
import { createTestStore } from '../../testing/app-store-test-fixture'

it('keeps the previous agents while a slow refresh runs', () => {
  const store = createTestStore()
  store.getState().publishBackgroundAgentsListing({
    status: 'ready',
    agents: [{ id: 'aaaa1111', sessionId: 's', name: 'bg', cwd: '/w', state: 'working' }],
    details: {},
    message: null
  })
  // A refresh that fails must not empty the list.
  store.getState().publishBackgroundAgentsListing({
    status: 'error',
    agents: [],
    details: {},
    message: 'the CLI timed out'
  })
  expect(store.getState().backgroundAgentsAgents).toHaveLength(1)
  expect(store.getState().backgroundAgentsStatus).toBe('error')
  expect(store.getState().backgroundAgentsMessage).toBe('the CLI timed out')
})

it('empties the agents when the machine has no Claude Code CLI at all', () => {
  const store = createTestStore()
  store.getState().publishBackgroundAgentsListing({
    status: 'ready',
    agents: [{ id: 'aaaa1111', sessionId: 's', name: 'bg', cwd: '/w', state: 'working' }],
    details: {},
    message: null
  })
  store.getState().publishBackgroundAgentsListing({
    status: 'unsupported',
    agents: [],
    details: {},
    message: null
  })
  expect(store.getState().backgroundAgentsAgents).toHaveLength(0)
  expect(store.getState().backgroundAgentsStatus).toBe('unsupported')
})

it('replaces the details without touching the agents', () => {
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
  expect(store.getState().backgroundAgentsDetails.aaaa1111.detail).toBe('now doing X')
  expect(store.getState().backgroundAgentsAgents).toHaveLength(1)
})

it('opens and closes an agent', () => {
  const store = createTestStore()
  store.getState().openBackgroundAgent('aaaa1111')
  expect(store.getState().backgroundAgentsScreen).toEqual({ kind: 'agent', agentId: 'aaaa1111' })
  store.getState().closeBackgroundAgent()
  expect(store.getState().backgroundAgentsScreen).toEqual({ kind: 'list' })
})
