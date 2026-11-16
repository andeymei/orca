import { AgentStateDot, type AgentDotState } from '@/components/AgentStateDot'
import { cn } from '@/lib/class-names'
import type { ClaudeBackgroundAgentState } from '../../../../shared/claude-background-agents'
import {
  formatBackgroundAgentElapsed,
  type BackgroundAgentListRow
} from './background-agent-list-rows'

/** The CLI's own state word, in the vocabulary the shared agent glyphs use. */
function dotStateFor(state: ClaudeBackgroundAgentState): AgentDotState {
  switch (state) {
    case 'working':
      return 'working'
    // The CLI's 'blocked' means the agent waits for an answer, not that it faulted.
    case 'blocked':
      return 'waiting'
    case 'failed':
      return 'failed'
    case 'done':
      return 'done'
    case 'stopped':
      return 'interrupted'
  }
}

/** One background agent: which agent it is, what it is called, and what it is doing. */
export function BackgroundAgentRowView({
  row,
  selected,
  onSelect,
  now,
  hint = null,
  onKeyDown
}: {
  row: BackgroundAgentListRow
  selected: boolean
  onSelect: (row: BackgroundAgentListRow) => void
  /** Epoch ms the elapsed column counts from; the list ticks it every second. */
  now?: number
  /** The inline hint the two-step confirmation shows. */
  hint?: React.ReactNode
  /** The panel's keys, so a row that holds the focus still answers them. */
  onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void
}): React.JSX.Element {
  const elapsed =
    now !== undefined && row.startedAt > 0
      ? formatBackgroundAgentElapsed(now - row.startedAt)
      : null
  // Why: a blocked agent's line says what it is asking; the other lines say what it is doing.
  const activity = row.section === 'needs-input' && row.needs ? row.needs : row.detail
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-selected={selected ? 'true' : undefined}
      data-testid="background-agent-row"
      // Why: a row in the tab order takes the focus the panel's keys need, and the root's
      // keyboard guard would then turn every key into a no-op.
      tabIndex={-1}
      onClick={() => onSelect(row)}
      onKeyDown={onKeyDown}
      className={cn(
        // Why `jump-palette-item`: flat accent is invisible as a keyboard cursor on light surfaces.
        'jump-palette-item flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
        'hover:bg-accent/60'
      )}
    >
      <span aria-hidden="true" className="w-2 shrink-0 text-muted-foreground">
        {selected ? '❯' : ''}
      </span>
      <AgentStateDot state={dotStateFor(row.state)} />
      <span className="min-w-0 flex-1 truncate text-xs text-foreground">{row.name}</span>
      {activity ? (
        <span className="min-w-0 shrink truncate text-2xs text-muted-foreground">{activity}</span>
      ) : null}
      {hint ? <span className="shrink-0 text-2xs text-muted-foreground">{hint}</span> : null}
      {elapsed ? (
        <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">{elapsed}</span>
      ) : null}
    </button>
  )
}
