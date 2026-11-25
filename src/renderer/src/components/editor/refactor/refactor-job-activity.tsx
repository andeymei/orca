import { Loader2 } from 'lucide-react'

import { useTranslate } from '@/i18n/use-translate'

/** How long the job may go without a new step before the tab names the silence. */
const IDLE_HINT_MS = 20_000

export type RefactorJobActivityProps = {
  /** Whether the job is still running. */
  running: boolean
  /** The milliseconds the job has been running. */
  elapsedMs: number
  /** The milliseconds since the job last named a step. */
  idleMs: number
}

/**
 * The heartbeat of a running job: a spinner, the time it has run, and how long it has been quiet.
 *
 * Why it says how long the silence is: the agent's steps come far apart, and a header that only
 * says "Generating" reads as a stuck app rather than a busy agent.
 */
export function RefactorJobActivity({
  running,
  elapsedMs,
  idleMs
}: RefactorJobActivityProps): React.JSX.Element | null {
  const t = useTranslate()
  if (!running) {
    return null
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 className="size-3 shrink-0 animate-spin" />
      <span>
        {t('auto.components.editor.RefactorJobActivity.elapsed', '{{time}} elapsed', {
          time: formatDuration(elapsedMs)
        })}
      </span>
      {idleMs >= IDLE_HINT_MS ? (
        <span>
          {t('auto.components.editor.RefactorJobActivity.idle', '· no new step for {{time}}', {
            time: formatDuration(idleMs)
          })}
        </span>
      ) : null}
    </span>
  )
}

/** A duration as the user reads it: seconds, then minutes and seconds. */
export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}
