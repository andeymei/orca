import type { AgentSessionBackgroundTerminal } from '../../../../shared/agent-session/lifecycle/agent-session-background-terminal'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { detectAgentStatusFromTitle } from '../../../../shared/agent-status/title/agent-title-status'
import { resolveExplicitTerminalTitleAgentType } from '../../../../shared/agent-status/title/terminal-title-agent-type'

/** A terminal tab, as the renderer knows it: its live title is what names the agent. */
export type BackgroundAgentTerminalTab = {
  /** The tab that carries the terminal. */
  tabId: string
  worktreeId: string
  executionHostId?: ExecutionHostId
  /** The terminal's live title. */
  title: string
}

/**
 * The terminals that are running an agent.
 *
 * A terminal agent is recognised by its title, the same classification the sidebar uses to badge
 * a working agent, so a shell the user started an agent CLI in counts as one. The tab on screen
 * is left out: the user is already looking at it.
 */
export function backgroundAgentTerminalRows(
  tabs: readonly BackgroundAgentTerminalTab[],
  visibleTabId: string | null
): AgentSessionBackgroundTerminal[] {
  const rows: AgentSessionBackgroundTerminal[] = []
  for (const tab of tabs) {
    if (tab.tabId === visibleTabId) {
      continue
    }
    const status = detectAgentStatusFromTitle(tab.title)
    if (status === null) {
      continue
    }
    const agent = resolveExplicitTerminalTitleAgentType(tab.title)
    if (agent === null) {
      continue
    }
    rows.push({
      tabId: tab.tabId,
      agent,
      title: tab.title,
      workspaceId: tab.worktreeId,
      ...(tab.executionHostId ? { executionHostId: tab.executionHostId } : {}),
      state: status === 'working' ? 'working' : 'idle'
    })
  }
  return rows
}
