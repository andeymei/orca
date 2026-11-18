import type { AgentStatusEntry } from '../../../../../shared/agent-status/contracts/agent-status-types'
import { isTuiAgent } from '../../../../../shared/agent-launch/catalog/tui-agent-config'
import type { PaneForegroundAgentEntry } from '../../../store/slices/agent-status/pane-foreground-agent'

/** The pane's agent type, by the same forensics the paste bracketing uses. */
export function resolveTerminalComposerAgentType(
  state: {
    paneForegroundAgentByPaneKey: Record<string, PaneForegroundAgentEntry>
    agentStatusByPaneKey: Record<string, AgentStatusEntry>
  },
  paneKey: string
): string | null {
  const foregroundAgent = state.paneForegroundAgentByPaneKey[paneKey]?.agent
  const entry = state.agentStatusByPaneKey[paneKey]
  // Rehydrated rows describe a previous process, not this pane's current foreground.
  return isTuiAgent(foregroundAgent)
    ? foregroundAgent
    : entry?.restoredUnconfirmed !== true && isTuiAgent(entry?.agentType)
      ? entry.agentType
      : null
}
