import { lazy } from 'react'
import { ModalBoundary } from './app-root-surface-boundaries'
import { useAppStore } from '../store/index'

const BackgroundAgentPickerDialog = lazy(() =>
  import('../components/background-agents/BackgroundAgentPickerDialog').then((module) => ({
    default: module.BackgroundAgentPickerDialog
  }))
)

/** The New Tab menu opens this; it lists the chats that kept running while Orca was closed. */
export function BackgroundAgentsModal(): React.JSX.Element | null {
  const activeModal = useAppStore((state) => state.activeModal)
  if (activeModal !== 'background-agents') {
    return null
  }
  return (
    <ModalBoundary boundaryId="modal.background-agents" resetKey>
      <BackgroundAgentPickerDialog />
    </ModalBoundary>
  )
}
