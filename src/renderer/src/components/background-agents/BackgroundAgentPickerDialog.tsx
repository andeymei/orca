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
import { useBackgroundAgentSessions } from './use-background-agent-sessions'
import {
  backgroundAgentSessionStateLabel,
  filterBackgroundAgentSessions,
  groupBackgroundAgentSessions
} from './background-agent-session-list'

function workspaceNameFor(workspaceId: string): string {
  const worktree = findWorktreeById(useAppStore.getState(), workspaceId)
  return (
    (worktree && resolveWorktreeDisplayName(worktree)) ||
    getWorktreePathBasenameFromId(workspaceId) ||
    workspaceId
  )
}

function BackgroundAgentSessionRow({
  session,
  onOpen
}: {
  session: AgentSessionBackgroundSession
  onOpen: (session: AgentSessionBackgroundSession) => void
}): React.JSX.Element {
  const t = useTranslate()
  const agentLabel = formatAgentTypeLabel(session.agent)
  const title =
    session.title.trim() || t('auto.components.backgroundAgents.untitled', 'Untitled chat')
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
      onClick={() => onOpen(session)}
    >
      <span role="img" aria-label={agentLabel} className="inline-flex shrink-0">
        <AgentIcon agent={agentTypeToIconAgent(session.agent)} size={13} />
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-foreground/90">{title}</span>
      <span className="shrink-0 text-2xs text-muted-foreground">
        {backgroundAgentSessionStateLabel(session.state, t)}
      </span>
      <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
        {formatShortTimeAgo(session.updatedAt)}
      </span>
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
    const sessions = state.state === 'ready' ? state.sessions : []
    return groupBackgroundAgentSessions(
      filterBackgroundAgentSessions(sessions, query, workspaceNameFor)
    )
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
              'Chats that are not on screen. Open one to pick it back up.'
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
            <div key={group.workspaceId} className="flex flex-col gap-0.5">
              <div className="px-2 pt-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                {workspaceNameFor(group.workspaceId)}
              </div>
              {group.sessions.map((session) => (
                <BackgroundAgentSessionRow
                  key={session.sessionId}
                  session={session}
                  onOpen={openSession}
                />
              ))}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
