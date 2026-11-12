// List the structured chats that are not on screen, so a client can offer them for re-entry.
// The offer list is a subset: it only holds chats that were working when the app went away.

import { defineMethod } from '../../../core'
import {
  ensureStructuredHostInstalled,
  requireStructuredHost
} from '../creation/structured-agent-session-gate'
import { structuredAgentsReadBy } from '../structured-agent-session-policy'
import { listStructuredBackgroundSessions } from '../../../../../native-chat/agent-session-wire/host/structured-agent-session-background-sessions'
import type { AgentSessionBackgroundSession } from '../../../../../../shared/agent-session/lifecycle/agent-session-background-session'
import type { AgentSessionStatusSummary } from '../../../../../../shared/agent-session/agent-session-wire'

export const STRUCTURED_AGENT_SESSION_BACKGROUND_METHODS = [
  defineMethod({
    name: 'agentSession.backgroundList',
    permission: 'workspace',
    params: null,
    handler: async (_params, ctx): Promise<{ sessions: AgentSessionBackgroundSession[] }> => {
      await ensureStructuredHostInstalled(ctx)
      const host = requireStructuredHost(ctx)
      const audience = structuredAgentsReadBy(ctx, host.knownAgentIds())
      const conversations = host.deps.store
        .listConversations()
        .filter((conversation) => audience?.(conversation.provider) ?? true)
      const interruptedSessionIds = new Set(
        (await host.restartResume.list(audience)).map((offer) => offer.sessionId)
      )
      const visibleTabSessionIds = new Set(
        conversations
          .filter((conversation) => host.isSessionTabVisible(conversation.sessionId))
          .map((conversation) => conversation.sessionId)
      )
      const summaries = new Map<string, AgentSessionStatusSummary>()
      for (const conversation of conversations) {
        const summary = host.readStatusSummary(conversation.sessionId)
        if (summary) {
          summaries.set(conversation.sessionId, summary)
        }
      }
      return {
        sessions: listStructuredBackgroundSessions({
          conversations,
          summaries,
          interruptedSessionIds,
          visibleTabSessionIds
        })
      }
    }
  })
]
