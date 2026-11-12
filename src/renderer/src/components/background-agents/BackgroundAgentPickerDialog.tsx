import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { AgentIcon } from '@/components/agent/icons/AgentIcon'
import { agentTypeToIconAgent } from '../../../../shared/agent-status/presentation/agent-type-icon-agent'
import { formatAgentTypeLabel } from '../../../../shared/agent-status/presentation/agent-type-label'
import { formatShortTimeAgo } from '@/lib/time-format/short-time-ago'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store/index'
import { findWorktreeById } from '@/store/github/refresh/worktree-refresh'
import { resolveWorktreeDisplayName } from '@/lib/workspace/display/worktree-default-display-name'
import { getWorktreePathBasenameFromId } from '../../../../shared/worktree/id'
import { activateAiVaultStructuredSession } from '@/lib/agent-session/open/activate-ai-vault-structured-session'
import type { AgentSessionBackgroundSession } from '../../../../shared/agent-session/lifecycle/agent-session-background-session'
import type { AgentSessionBackgroundTerminal } from '../../../../shared/agent-session/lifecycle/agent-session-background-terminal'
import type { AiVaultSession } from '../../../../shared/ai-vault/contracts/ai-vault-types'
import { useBackgroundAgentSessions } from './use-background-agent-sessions'
import { openBackgroundAgentSession } from './background-agent-vault-resume'
import {
  backgroundAgentRowStateLabel,
  filterBackgroundAgentRows,
  groupBackgroundAgentRows,
  type BackgroundAgentRow
} from './background-agent-session-list'

function workspaceNameFor(workspaceId: string): string {
  const worktree = findWorktreeById(useAppStore.getState(), workspaceId)
  return (
    (worktree && resolveWorktreeDisplayName(worktree)) ||
    getWorktreePathBasenameFromId(workspaceId) ||
    workspaceId
  )
}

function BackgroundAgentRowView({
  row,
  onOpenChat,
  onOpenTerminal,
  onOpenVault
}: {
  row: BackgroundAgentRow
  onOpenChat: (session: AgentSessionBackgroundSession) => void
  onOpenTerminal: (terminal: AgentSessionBackgroundTerminal) => void
  onOpenVault: (session: AiVaultSession) => void
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
      onClick={() =>
        row.kind === 'chat'
          ? onOpenChat(row.chat)
          : row.kind === 'terminal'
            ? onOpenTerminal(row.terminal)
            : onOpenVault(row.vault)
      }
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

export function BackgroundAgentPickerDialog(): React.JSX.Element | null {
  const t = useTranslate()
  const [query, setQuery] = useState('')
  const activeModal = useAppStore((state) => state.activeModal)
  const closeModal = useAppStore((state) => state.closeModal)
  const open = activeModal === 'background-agents'
  const { state } = useBackgroundAgentSessions(open)

  const groups = useMemo(() => {
    const rows = state.state === 'ready' ? state.rows : []
    return groupBackgroundAgentRows(filterBackgroundAgentRows(rows, query, workspaceNameFor))
  }, [state, query])

  if (!open) {
    return null
  }

  const openSession = (session: AgentSessionBackgroundSession): void => {
    closeModal()
    void activateAiVaultStructuredSession({
      agent: session.agent,
      structuredSession: { sessionId: session.sessionId, workspaceId: session.workspaceId }
    })
  }

  const openTerminal = (terminal: AgentSessionBackgroundTerminal): void => {
    closeModal()
    const store = useAppStore.getState()
    if (store.activeWorktreeId !== terminal.workspaceId) {
      // The agent runs in another workspace; land there before its tab.
      if (!store.setActiveWorktree(terminal.workspaceId, terminal.executionHostId)) {
        return
      }
    }
    store.activateTab(terminal.tabId, { worktreeId: terminal.workspaceId })
  }

  const openVault = (session: AiVaultSession): void => {
    closeModal()
    void openBackgroundAgentSession(session)
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) {
          closeModal()
        }
      }}
    >
      <DialogContent className="grid-rows-[auto_minmax(0,1fr)] sm:max-w-lg max-h-[70vh]">
        <DialogHeader>
          <DialogTitle>
            {t('auto.components.backgroundAgents.title', 'Background agents')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'auto.components.backgroundAgents.description',
              'Agents and chats that are not on screen. Open one to pick it back up.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto scrollbar-sleek">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t(
              'auto.components.backgroundAgents.searchPlaceholder',
              'Search background agents'
            )}
            aria-label={t(
              'auto.components.backgroundAgents.searchLabel',
              'Search background agents'
            )}
          />
          {state.state === 'loading' ? (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('auto.components.backgroundAgents.loading', 'Loading background agents')}
            </div>
          ) : null}
          {state.state === 'ready' && groups.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              {t('auto.components.backgroundAgents.empty', 'No background agents')}
            </div>
          ) : null}
          {groups.map((group) => (
            <div key={group.workspaceId ?? group.label} className="flex flex-col gap-0.5">
              <div className="px-2 pt-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group.workspaceId === null ? group.label : workspaceNameFor(group.workspaceId)}
              </div>
              {group.rows.map((row) => (
                <BackgroundAgentRowView
                  key={
                    row.kind === 'chat'
                      ? row.chat.sessionId
                      : row.kind === 'terminal'
                        ? row.terminal.tabId
                        : row.vault.sessionId
                  }
                  row={row}
                  onOpenChat={openSession}
                  onOpenTerminal={openTerminal}
                  onOpenVault={openVault}
                />
              ))}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
