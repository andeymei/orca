import type {
  AgentSessionBackgroundSession,
  AgentSessionBackgroundState
} from '../../../../shared/agent-session/lifecycle/agent-session-background-session'
import type { AgentSessionBackgroundTerminal } from '../../../../shared/agent-session/lifecycle/agent-session-background-terminal'
import type { AiVaultSession } from '../../../../shared/ai-vault/contracts/ai-vault-types'

/** Where a row belongs: the workspace heading it groups under. */
export type BackgroundAgentWorkspace = {
  /** The workspace id, when Orca knows one. */
  id: string | null
  /** What the group heading shows. */
  label: string
}

/** One row in the picker: a chat Orca keeps in the AI Vault, a terminal running an agent, or an
 *  agent session this machine has but Orca does not show. */
export type BackgroundAgentRow =
  | {
      kind: 'chat'
      chat: AgentSessionBackgroundSession
      workspace: BackgroundAgentWorkspace
    }
  | {
      kind: 'terminal'
      terminal: AgentSessionBackgroundTerminal
      workspace: BackgroundAgentWorkspace
    }
  | {
      kind: 'vault'
      vault: AiVaultSession
      workspace: BackgroundAgentWorkspace
    }

export type BackgroundAgentGroup = {
  workspaceId: string | null
  label: string
  rows: readonly BackgroundAgentRow[]
}

/** Rows of one workspace, so the user sees where a background agent would land. */
export function groupBackgroundAgentRows(
  rows: readonly BackgroundAgentRow[]
): BackgroundAgentGroup[] {
  const groups = new Map<
    string,
    { workspaceId: string | null; label: string; rows: BackgroundAgentRow[] }
  >()
  for (const row of rows) {
    const key = row.workspace.id ?? `label:${row.workspace.label}`
    const group = groups.get(key)
    if (group) {
      group.rows.push(row)
    } else {
      groups.set(key, {
        workspaceId: row.workspace.id,
        label: row.workspace.label,
        rows: [row]
      })
    }
  }
  return [...groups.values()]
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
        : row.kind === 'terminal'
          ? [row.terminal.title, row.terminal.agent, workspaceName(row.terminal.workspaceId)]
          : [row.vault.title, row.vault.agent, row.workspace.label, row.vault.cwd ?? '']
    return haystacks.some((value) => value.toLowerCase().includes(needle))
  })
}

/** What the agent is doing now, in the user's words. */
export function backgroundAgentRowStateLabel(
  row: BackgroundAgentRow,
  t: (key: string, fallback: string) => string
): string | null {
  if (row.kind === 'terminal') {
    return row.terminal.state === 'working'
      ? t('auto.components.backgroundAgents.stateRunning', 'Still running')
      : t('auto.components.backgroundAgents.stateIdle', 'Waiting')
  }
  if (row.kind === 'vault') {
    // A transcript on disk says nothing about whether its agent is running now.
    return null
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
