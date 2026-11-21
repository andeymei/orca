import { Loader2 } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import type { BackgroundAgentsDispatch } from '@/store/slices/background-agents/create-background-agents-slice'

/**
 * The row that stands in for the agent a dispatch is on its way to bring up.
 *
 * It carries the dispatch's own state, so the user can see that the panel is working and can stop
 * waiting for it.
 */
export function BackgroundAgentDispatchRow({
  dispatch,
  onCancel
}: {
  dispatch: BackgroundAgentsDispatch
  onCancel: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const label =
    dispatch.state === 'failed'
      ? (dispatch.message ??
        t('auto.components.backgroundAgents.dispatchFailed', 'The agent could not be started'))
      : dispatch.state === 'started'
        ? t('auto.components.backgroundAgents.dispatchStarted', 'started · {{id}}', {
            id: dispatch.agentId ?? ''
          })
        : dispatch.state === 'cancelling'
          ? t('auto.components.backgroundAgents.dispatchingCancelling', 'cancelling…')
          : t('auto.components.backgroundAgents.dispatching', 'opening… · esc to cancel')

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && dispatch.state === 'opening') {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    }
  }

  return (
    <div
      role="status"
      data-testid="background-agent-dispatch-row"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs"
    >
      {dispatch.state === 'opening' ? (
        <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
      ) : null}
      <span
        className={
          dispatch.state === 'failed'
            ? 'min-w-0 flex-1 truncate text-destructive'
            : 'min-w-0 flex-1 truncate text-muted-foreground'
        }
      >
        {label}
      </span>
    </div>
  )
}
