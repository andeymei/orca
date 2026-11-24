import type { TerminalAgent } from '../../../../../shared/agent-status/identity/terminal-agent'
import type { AppState } from '../../../store/types'
import { resolvePaneForegroundAgentType } from '../agent-status/pane-foreground-agent-type'

/** The pane's agent type, by the same rule the paste bracketing reads. */
export function resolveTerminalComposerAgentType(
  state: Pick<AppState, 'paneForegroundAgentByPaneKey' | 'agentStatusByPaneKey'>,
  paneKey: string
): TerminalAgent | null {
  return resolvePaneForegroundAgentType(
    state.paneForegroundAgentByPaneKey[paneKey]?.agent,
    state.agentStatusByPaneKey.get(paneKey)
  )
}
