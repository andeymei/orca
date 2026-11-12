import type { AgentSessionStatusSummary } from '../../../../shared/agent-session/agent-session-wire'
import type { AgentSessionBackgroundSession } from '../../../../shared/agent-session/lifecycle/agent-session-background-session'
import type { AgentSessionBackgroundState } from '../../../../shared/agent-session/lifecycle/agent-session-background-session'
import type { AgentSessionConversationView } from '../../../../shared/agent-session/lifecycle/agent-session-conversation-view'

/** A profile can hold many chats; the picker shows the newest ones and searches the rest. */
export const AGENT_SESSION_BACKGROUND_LIST_LIMIT = 50

function firstText(...values: (string | undefined)[]): string {
  for (const value of values) {
    if (value !== undefined && value.trim() !== '') {
      return value
    }
  }
  return ''
}

/** The host's own answers decide the state; the lease only says who owns the record. */
export function backgroundSessionState(
  conversation: AgentSessionConversationView,
  summary: AgentSessionStatusSummary | undefined,
  interruptedSessionIds: ReadonlySet<string>
): AgentSessionBackgroundState {
  if (interruptedSessionIds.has(conversation.sessionId)) {
    return 'interrupted'
  }
  if (summary?.hostExecutionOwned === true) {
    return 'running'
  }
  if (conversation.sleptAt !== undefined || summary?.sleptAt !== undefined) {
    return 'slept'
  }
  return 'idle'
}

/** The chats that are not on screen, newest first.
 *  A chat that never ran has nothing to re-enter, and one that is already visible needs no list. */
export function listStructuredBackgroundSessions(input: {
  conversations: readonly AgentSessionConversationView[]
  summaries: ReadonlyMap<string, AgentSessionStatusSummary>
  interruptedSessionIds: ReadonlySet<string>
  visibleTabSessionIds: ReadonlySet<string>
  limit?: number
}): AgentSessionBackgroundSession[] {
  const limit = input.limit ?? AGENT_SESSION_BACKGROUND_LIST_LIMIT
  const sessions: AgentSessionBackgroundSession[] = []
  for (const conversation of input.conversations) {
    if (conversation.neverStarted) {
      continue
    }
    if (input.visibleTabSessionIds.has(conversation.sessionId)) {
      continue
    }
    const summary = input.summaries.get(conversation.sessionId)
    sessions.push({
      sessionId: conversation.sessionId,
      workspaceId: conversation.location.workspaceId,
      workspaceKind: conversation.location.workspaceKind,
      agent: conversation.provider,
      title: firstText(
        conversation.conversationName,
        summary?.conversationName,
        summary?.latestPrompt
      ),
      launchDirectory: conversation.launchDirectory,
      updatedAt: Math.max(conversation.updatedAt, summary?.updatedAt ?? 0),
      state: backgroundSessionState(conversation, summary, input.interruptedSessionIds)
    })
  }
  sessions.sort((left, right) => right.updatedAt - left.updatedAt)
  return sessions.slice(0, limit)
}
