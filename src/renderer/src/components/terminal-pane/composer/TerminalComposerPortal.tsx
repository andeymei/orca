import { createPortal } from 'react-dom'
import { useAppStore } from '@/store'
import { makePaneKey } from '../../../../../shared/workspace-layout/stable-pane-id'
import type { TerminalPaneController } from '../controller/use-terminal-pane-controller'
import { TerminalComposerOverlay } from './TerminalComposerOverlay'
import { resolveTerminalComposerAgentType } from './terminal-composer-agent'

/** The composer rides the active pane's container, so it moves with the pane. */
export function TerminalComposerPortal({
  controller
}: {
  controller: TerminalPaneController
}): React.JSX.Element | null {
  const { activePane, cwd, managerRef, paneTransportsRef, tabId, worktreeId } = controller
  const paneKey = activePane ? makePaneKey(tabId, activePane.leafId) : null
  const agent = useAppStore((state) =>
    paneKey ? resolveTerminalComposerAgentType(state, paneKey) : null
  )
  if (!activePane?.container || !paneKey) {
    return null
  }
  return createPortal(
    <TerminalComposerOverlay
      paneKey={paneKey}
      paneId={activePane.id}
      leafId={activePane.leafId}
      tabId={tabId}
      cwd={cwd}
      worktreeId={worktreeId}
      agent={agent}
      managerRef={managerRef}
      paneTransportsRef={paneTransportsRef}
    />,
    activePane.container,
    `terminal-composer-${activePane.id}`
  )
}
