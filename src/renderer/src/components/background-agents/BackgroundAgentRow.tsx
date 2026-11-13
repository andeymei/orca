import { AgentIcon } from '@/components/agent/icons/AgentIcon'
import { agentTypeToIconAgent } from '../../../../shared/agent-status/presentation/agent-type-icon-agent'
import { formatAgentTypeLabel } from '../../../../shared/agent-status/presentation/agent-type-label'
import { formatShortTimeAgo } from '@/lib/time-format/short-time-ago'
import { useTranslate } from '@/i18n/use-translate'
import {
  backgroundAgentRowStateLabel,
  type BackgroundAgentRow
} from './background-agent-session-list'

/** One background agent: which agent it is, what it is called, and what it is doing. */
export function BackgroundAgentRowView({
  row,
  onSelect
}: {
  row: BackgroundAgentRow
  onSelect: (row: BackgroundAgentRow) => void
}): React.JSX.Element {
  const t = useTranslate()
  const agent =
    row.kind === 'chat'
      ? row.chat.agent
      : row.kind === 'terminal'
        ? row.terminal.agent
        : row.vault.agent
  const agentLabel = formatAgentTypeLabel(agent)
  const title =
    (row.kind === 'chat'
      ? row.chat.title.trim()
      : row.kind === 'terminal'
        ? row.terminal.title.trim()
        : row.vault.title.trim()) || t('auto.components.backgroundAgents.untitled', 'Untitled chat')
  // A terminal carries no last-activity time; only a chat knows when it was last used.
  const updatedAt =
    row.kind === 'chat'
      ? row.chat.updatedAt
      : row.kind === 'vault'
        ? Date.parse(row.vault.updatedAt ?? '') || undefined
        : undefined
  const stateLabel = backgroundAgentRowStateLabel(row, t)
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
      data-testid="background-agent-row"
      onClick={() => onSelect(row)}
    >
      <span role="img" aria-label={agentLabel} className="inline-flex shrink-0">
        <AgentIcon agent={agentTypeToIconAgent(agent)} size={13} />
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-foreground/90">{title}</span>
      {stateLabel === null ? null : (
        <span className="shrink-0 text-2xs text-muted-foreground">{stateLabel}</span>
      )}
      {updatedAt === undefined ? null : (
        <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
          {formatShortTimeAgo(updatedAt)}
        </span>
      )}
    </button>
  )
}
