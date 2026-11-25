import React from 'react'
import { AgentStateDot, agentStateLabel } from '@/components/agent/status/AgentStateDot'
import { AgentTypeIcon } from '@/components/agent/icons/agent-type-icon'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useAgentRowConversationName } from '@/components/dashboard/rows/use-agent-row-conversation-name'
import { lastEnteredDoneAt } from '@/components/dashboard/rows/agent-finished-timestamp'
import type { DashboardAgentRow as DashboardAgentRowData } from '@/components/dashboard/rows/dashboard-agent-row'
import { agentSendDisabledReasonLabel } from '@/lib/agent-session/messaging/agent-send-disabled-reason-label'
import { translate } from '@/i18n/i18n'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { formatAgentTypeLabel } from '../../../../../shared/agent-status/presentation/agent-type-label'
import { getAgentRowPrimaryText } from '../../../../../shared/agent-status/presentation/agent-row-primary-text'
import { agentRowDisplayDotState } from '../../../../../shared/agent-row-dot-state'
import type { NotesSendAgentTarget } from '@/lib/agent-session/messaging/notes-send-agent-targets'

export type AgentTargetMenuItemProps = {
  target: NotesSendAgentTarget
  agent: DashboardAgentRowData | null
  now: number
  disabled: boolean
  onSend: (target: NotesSendAgentTarget) => void
}

export function AgentRowTargetMenuItem(
  props: AgentTargetMenuItemProps & { agent: DashboardAgentRowData }
): React.JSX.Element {
  const conversationName = useAgentRowConversationName(props.agent)
  // Same name as the agent's sidebar row, so same-type agents stay distinguishable.
  const name = conversationName ?? getAgentRowPrimaryText(props.agent.entry)
  return <AgentTargetMenuItem {...props} name={name} />
}

export function AgentTargetMenuItem({
  target,
  agent,
  name,
  now,
  disabled,
  onSend
}: AgentTargetMenuItemProps & { name: string }): React.JSX.Element {
  const t = useTranslate()
  const tabTitle = target.tabTitle.trim()
  const typeLabel = formatAgentTypeLabel(target.agentType ?? agent?.agentType)
  // Use the sidebar’s display state so failed/stopped agents agree across surfaces.
  const state = agent ? agentRowDisplayDotState(agent) : 'idle'
  const timeAgo = agent ? formatAgentRelativeTime(agent, now, t) : null
  const disabledReason =
    target.status === 'disabled' && target.disabledReason
      ? agentSendDisabledReasonLabel(target.disabledReason, t)
      : undefined
  const secondaryParts = [
    ...(name ? [typeLabel] : []),
    agentStateLabel(state),
    ...(timeAgo ? [timeAgo] : []),
    // Why: unnamed rows keep the raw tab title as their only differentiator.
    ...(!name && tabTitle ? [tabTitle] : [])
  ]
  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={() => onSend(target)}
      // Match dashboard tooltips for disabled reasons; otherwise show the full, possibly truncated, name.
      title={disabledReason ?? (name || undefined)}
      className="min-w-[240px] gap-2 rounded-[7px] px-2 py-1.5 text-[12px] leading-5 font-medium"
    >
      {/* Why: the ancestor's actionable disabled reason must win on every hit area. */}
      <AgentStateDot
        state={state}
        size="sm"
        className="shrink-0"
        title={disabledReason ? null : undefined}
      />
      <AgentTypeIcon agentType={target.agentType ?? agent?.agentType} size={14} />
      <span className="grid max-w-[300px] min-w-0 flex-1 text-left">
        <span className="truncate">{name || typeLabel}</span>
        <span className="truncate text-[11px] font-normal text-muted-foreground">
          {secondaryParts.join(' · ')}
        </span>
      </span>
    </DropdownMenuItem>
  )
}

function formatAgentRelativeTime(
  agent: DashboardAgentRowData,
  now: number,
  t?: Translate
): string | null {
  const doneAt = lastEnteredDoneAt(agent)
  if (doneAt !== null) {
    return `${formatTimeAgo(doneAt, now, t)}`
  }
  const startedAt = agent.startedAt > 0 ? agent.startedAt : agent.entry.stateStartedAt
  return startedAt > 0 ? `${formatTimeAgo(startedAt, now, t)}` : null
}

function formatTimeAgo(ts: number, now: number, t: Translate = translate): string {
  const delta = now - ts
  if (delta < 60_000) {
    return t('auto.components.editor.ReviewNotesSendMenu.justNow', 'just now')
  }
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 60) {
    return t('auto.components.editor.ReviewNotesSendMenu.minutesAgo', '{{minutes}}m ago', {
      minutes
    })
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return t('auto.components.editor.ReviewNotesSendMenu.hoursAgo', '{{hours}}h ago', {
      hours
    })
  }
  return t('auto.components.editor.ReviewNotesSendMenu.daysAgo', '{{days}}d ago', {
    days: Math.floor(hours / 24)
  })
}
