import { useAppStore } from '@/store/index'
import { BackgroundAgentAgentScreen } from './BackgroundAgentAgentScreen'
import { BackgroundAgentListScreen } from './BackgroundAgentListScreen'

/**
 * The supervisor's two screens: the roster of background agents, and one agent's own terminal.
 *
 * The store holds the screen, so it survives the sidebar unmounting the panel.
 */
export default function BackgroundAgentsPanel(): React.JSX.Element {
  const screen = useAppStore((state) => state.backgroundAgentsScreen)
  return screen.kind === 'list' ? (
    <BackgroundAgentListScreen />
  ) : (
    <BackgroundAgentAgentScreen agentId={screen.agentId} />
  )
}
