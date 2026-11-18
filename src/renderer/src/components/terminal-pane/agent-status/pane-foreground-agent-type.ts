import type { AgentStatusEntry } from '../../../../../shared/agent-status/contracts/agent-status-types'
import type { TerminalAgent } from '../../../../../shared/agent-status/identity/terminal-agent'
import { isTuiAgent } from '../../../../../shared/agent-launch/catalog/tui-agent-config'

/**
 * The agent type of a pane: its foreground agent first, then the status row's agent.
 * The paste bracketing and the terminal composer both read it, so they cannot disagree
 * about which agent a pane runs.
 */
export function resolvePaneForegroundAgentType(
  foregroundAgent: unknown,
  entry: AgentStatusEntry | undefined
): TerminalAgent | null {
  // Rehydrated rows describe a previous process, not this pane's current foreground.
  return isTuiAgent(foregroundAgent)
    ? foregroundAgent
    : entry?.restoredUnconfirmed !== true && isTuiAgent(entry?.agentType)
      ? entry.agentType
      : null
}
