import type {
  AgentSessionBackgroundSession,
  AgentSessionBackgroundState
} from '../../../../shared/agent-session/lifecycle/agent-session-background-session'
import type { AgentSessionBackgroundTerminal } from '../../../../shared/agent-session/lifecycle/agent-session-background-terminal'

/** One row in the picker: a chat Orca keeps in the AI Vault, or a terminal running an agent. */
export type BackgroundAgentRow =
  | { kind: 'chat'; chat: AgentSessionBackgroundSession }
  | { kind: 'terminal'; terminal: AgentSessionBackgroundTerminal }

export type BackgroundAgentGroup = {
  workspaceId: string
  rows: readonly BackgroundAgentRow[]
}

/** Rows of one workspace, so the user sees where a background agent would land. */
export function groupBackgroundAgentRows(
  rows: readonly BackgroundAgentRow[]
): BackgroundAgentGroup[] {
  const groups = new Map<string, BackgroundAgentRow[]>()
  for (const row of rows) {
    const workspaceId = row.kind === 'chat' ? row.chat.workspaceId : row.terminal.workspaceId
    const group = groups.get(workspaceId)
    if (group) {
      group.push(row)
    } else {
      groups.set(workspaceId, [row])
    }
  }
  return [...groups].map(([workspaceId, groupRows]) => ({
    workspaceId,
    rows: groupRows
  }))
}

/** Match what the user can see: the agent's name, the agent that owns it, or the workspace it lives in. */
export function filterBackgroundAgentRows(
  rows: readonly BackgroundAgentRow[],
  query: string,
  workspaceName: (workspaceId: string) => string
): BackgroundAgentRow[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') {
    return [...rows]
  }
  return rows.filter((row) => {
    const haystacks =
      row.kind === 'chat'
        ? [
            row.chat.title,
            row.chat.agent,
            workspaceName(row.chat.workspaceId),
            row.chat.launchDirectory ?? ''
          ]
        : [row.terminal.title, row.terminal.agent, workspaceName(row.terminal.workspaceId)]
    return haystacks.some((value) => value.toLowerCase().includes(needle))
  })
}

/** What the agent is doing now, in the user's words. */
export function backgroundAgentRowStateLabel(
  row: BackgroundAgentRow,
  t: (key: string, fallback: string) => string
): string {
  if (row.kind === 'terminal') {
    return row.terminal.state === 'working'
      ? t('auto.components.backgroundAgents.stateRunning', 'Still running')
      : t('auto.components.backgroundAgents.stateIdle', 'Waiting')
  }
  return backgroundAgentSessionStateLabel(row.chat.state, t)
}

function backgroundAgentSessionStateLabel(
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
