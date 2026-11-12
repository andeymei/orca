import { expect, it } from 'vitest'
import { agentSessionRecordFixture } from '../../agent-session-record-test-fixture'
import { agentSessionConversationView } from '../../../../shared/agent-session/lifecycle/agent-session-conversation-view'
import type { AgentSessionRecord } from '../../../../shared/agent-session/lifecycle/agent-session-record'
import type { AgentSessionStatusSummary } from '../../../../shared/agent-session/agent-session-wire'
import { listStructuredBackgroundSessions } from './structured-agent-session-background-sessions'

type ConversationOverrides = Partial<Omit<AgentSessionRecord, 'location' | 'sessionId'>>

/** A claimed lease is what makes a chat started; the fixture's released fence is a chat that never ran. */
function startedConversation(sessionId: string, overrides: ConversationOverrides = {}) {
  const record = agentSessionRecordFixture({ ...overrides, sessionId })
  return agentSessionConversationView({
    ...record,
    lease: { ...record.lease, runtimeFence: 2 }
  })
}

function summary(overrides: Partial<AgentSessionStatusSummary> = {}): AgentSessionStatusSummary {
  return {
    sessionId: 'session-a',
    workspaceId: 'workspace-1',
    agent: 'claude',
    status: null,
    latestPrompt: '',
    updatedAt: 0,
    ...overrides
  }
}

it('leaves out chats that are already on screen and chats that never ran', () => {
  const sessions = listStructuredBackgroundSessions({
    conversations: [
      startedConversation('session-visible'),
      agentSessionConversationView(agentSessionRecordFixture({ sessionId: 'session-never-ran' })),
      startedConversation('session-background')
    ],
    summaries: new Map(),
    interruptedSessionIds: new Set(),
    visibleTabSessionIds: new Set(['session-visible'])
  })

  expect(sessions.map((session) => session.sessionId)).toEqual(['session-background'])
})

it('names a chat by its conversation name, then its newest prompt', () => {
  const conversations = [
    startedConversation('session-named', { conversationName: 'Refactor the parser' }),
    startedConversation('session-prompt')
  ]
  const sessions = listStructuredBackgroundSessions({
    conversations,
    summaries: new Map([
      [
        'session-prompt',
        summary({ sessionId: 'session-prompt', latestPrompt: 'Fix the flaky test' })
      ]
    ]),
    interruptedSessionIds: new Set(),
    visibleTabSessionIds: new Set()
  })

  expect(sessions.map((session) => session.title)).toEqual([
    'Refactor the parser',
    'Fix the flaky test'
  ])
})

it('reports how each chat can be re-entered', () => {
  const conversations = [
    startedConversation('session-running'),
    startedConversation('session-interrupted'),
    startedConversation('session-slept', { sleptAt: 5 }),
    startedConversation('session-idle')
  ]
  const sessions = listStructuredBackgroundSessions({
    conversations,
    summaries: new Map([
      ['session-running', summary({ sessionId: 'session-running', hostExecutionOwned: true })]
    ]),
    interruptedSessionIds: new Set(['session-interrupted']),
    visibleTabSessionIds: new Set()
  })

  expect(Object.fromEntries(sessions.map((session) => [session.sessionId, session.state]))).toEqual(
    {
      'session-running': 'running',
      'session-interrupted': 'interrupted',
      'session-slept': 'slept',
      'session-idle': 'idle'
    }
  )
})

it('lists the newest chats first and keeps the list bounded', () => {
  const conversations = [
    startedConversation('session-old', { updatedAt: 10 }),
    startedConversation('session-new', { updatedAt: 30 }),
    startedConversation('session-middle', { updatedAt: 20 })
  ]
  const sessions = listStructuredBackgroundSessions({
    conversations,
    summaries: new Map(),
    interruptedSessionIds: new Set(),
    visibleTabSessionIds: new Set(),
    limit: 2
  })

  expect(sessions.map((session) => session.sessionId)).toEqual(['session-new', 'session-middle'])
})
