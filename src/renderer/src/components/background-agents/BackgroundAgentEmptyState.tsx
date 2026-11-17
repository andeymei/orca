import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store/index'

/**
 * What the panel says when the open workspace has no agents.
 *
 * Without a workspace there is no project to speak of, so the panel asks for one instead of
 * claiming the project has none. With a workspace the panel says what it found — the scoped
 * roster — and leaves the rest to the notice above it.
 */
export function BackgroundAgentEmptyState(): React.JSX.Element {
  const t = useTranslate()
  const activeWorktreeId = useAppStore((state) => state.activeWorktreeId)
  return (
    <div className="py-6 text-center text-xs text-muted-foreground">
      {activeWorktreeId === null
        ? t(
            'auto.components.backgroundAgents.emptyNoWorkspace',
            'Open a project to see its background agents'
          )
        : t(
            'auto.components.backgroundAgents.empty',
            'No background agents found for this project'
          )}
    </div>
  )
}
