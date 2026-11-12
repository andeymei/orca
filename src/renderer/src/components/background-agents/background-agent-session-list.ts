import type {
  AgentSessionBackgroundSession,
  AgentSessionBackgroundState
} from '../../../../shared/agent-session/lifecycle/agent-session-background-session'

export type BackgroundAgentSessionGroup = {
  workspaceId: string
  sessions: readonly AgentSessionBackgroundSession[]
}

/** Chats of one workspace, so the user sees where a background chat would land. */
export function groupBackgroundAgentSessions(
  sessions: readonly AgentSessionBackgroundSession[]
): BackgroundAgentSessionGroup[] {
  const groups = new Map<string, AgentSessionBackgroundSession[]>()
  for (const session of sessions) {
    const group = groups.get(session.workspaceId)
    if (group) {
      group.push(session)
    } else {
      groups.set(session.workspaceId, [session])
    }
  }
  return [...groups].map(([workspaceId, groupSessions]) => ({
    workspaceId,
    sessions: groupSessions
  }))
}

/** Match what the user can see: the chat's name, the agent that owns it, or the workspace it lives in. */
export function filterBackgroundAgentSessions(
  sessions: readonly AgentSessionBackgroundSession[],
  query: string,
  workspaceName: (workspaceId: string) => string
): AgentSessionBackgroundSession[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') {
    return [...sessions]
  }
  return sessions.filter((session) => {
    const haystacks = [
      session.title,
      session.agent,
      workspaceName(session.workspaceId),
      session.launchDirectory ?? ''
    ]
    return haystacks.some((value) => value.toLowerCase().includes(needle))
  })
}

/** What the chat is doing now, in the user's words. */
export function backgroundAgentSessionStateLabel(
  state: AgentSessionBackgroundState,
  t: (key: string, fallback: string) => string
): string {
  switch (state) {
    case 'running':
      return t('auto.components.backgroundAgents.stateRunning', 'Still running')
    case 'interrupted':
      return t('auto.components.backgroundAgents.stateInterrupted', 'Interrupted when Orca closed')
    case 'slept':
      return t('auto.components.backgroundAgents.stateSlept', 'Sleeping')
    case 'idle':
      return t('auto.components.backgroundAgents.stateIdle', 'Waiting')
  }
}
