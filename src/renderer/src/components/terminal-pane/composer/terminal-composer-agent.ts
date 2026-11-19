import type { AgentStatusEntry } from '../../../../../shared/agent-status/contracts/agent-status-types'
import type { TerminalAgent } from '../../../../../shared/agent-status/identity/terminal-agent'
import type { PaneForegroundAgentEntry } from '../../../store/slices/agent-status/pane-foreground-agent'
import { resolvePaneForegroundAgentType } from '../agent-status/pane-foreground-agent-type'

/** The pane's agent type, by the same rule the paste bracketing reads. */
export function resolveTerminalComposerAgentType(
  state: {
    paneForegroundAgentByPaneKey: Record<string, PaneForegroundAgentEntry>
    agentStatusByPaneKey: Record<string, AgentStatusEntry>
  },
  paneKey: string
): TerminalAgent | null {
  return resolvePaneForegroundAgentType(
    state.paneForegroundAgentByPaneKey[paneKey]?.agent,
    state.agentStatusByPaneKey[paneKey]
  )
}
