import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store/index'
import { findWorktreeById } from '@/store/github/refresh/worktree-refresh'
import { resolveWorktreeDisplayName } from '@/lib/workspace/display/worktree-default-display-name'
import { getWorktreePathBasenameFromId } from '../../../../shared/worktree/id'
import { activateAiVaultStructuredSession } from '@/lib/agent-session/open/activate-ai-vault-structured-session'
import { useBackgroundAgentSessions } from './use-background-agent-sessions'
import { openBackgroundAgentSession } from './background-agent-vault-resume'
import { BackgroundAgentRowView } from './BackgroundAgentRow'
import { filterBackgroundAgentRows, type BackgroundAgentRow } from './background-agent-session-list'

function workspaceNameFor(workspaceId: string): string {
  const worktree = findWorktreeById(useAppStore.getState(), workspaceId)
  return (
    (worktree && resolveWorktreeDisplayName(worktree)) ||
    getWorktreePathBasenameFromId(workspaceId) ||
    workspaceId
  )
}

/**
 * The agents of the workspace the user is in that are not on screen.
 *
 * The panel follows the workspace: its own directory decides which sessions count, and its own
 * tabs and chats are the ones it lists. Opening a row brings that agent back.
 */
export default function BackgroundAgentsPanel(): React.JSX.Element {
  const t = useTranslate()
  const [query, setQuery] = useState('')
  const activeWorktreeId = useAppStore((state) => state.activeWorktreeId)
  const { state, reload } = useBackgroundAgentSessions(true)
  const listedWorkspaceId = useRef(activeWorktreeId)

  // The panel stays mounted across workspace switches, so the list is read again for the new one.
  useEffect(() => {
    if (listedWorkspaceId.current === activeWorktreeId) {
      return
    }
    listedWorkspaceId.current = activeWorktreeId
    reload()
  }, [activeWorktreeId, reload])
  const rows = useMemo(
    () =>
      state.state === 'ready' ? filterBackgroundAgentRows(state.rows, query, workspaceNameFor) : [],
    [state, query]
  )

  const openRow = (row: BackgroundAgentRow): void => {
    if (row.kind === 'chat') {
      void activateAiVaultStructuredSession({
        agent: row.chat.agent,
        structuredSession: { sessionId: row.chat.sessionId, workspaceId: row.chat.workspaceId }
      })
      return
    }
    if (row.kind === 'terminal') {
      const store = useAppStore.getState()
      if (store.activeWorktreeId !== row.terminal.workspaceId) {
        // The agent runs in another workspace; land there before its tab.
        if (!store.setActiveWorktree(row.terminal.workspaceId, row.terminal.executionHostId)) {
          return
        }
      }
      store.activateTab(row.terminal.tabId, { worktreeId: row.terminal.workspaceId })
      return
    }
    void openBackgroundAgentSession(row.vault)
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden"
      data-testid="background-agents-panel"
    >
      <div className="flex items-center gap-2 px-2 pt-2">
        <Input
          density="compact"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t(
            'auto.components.backgroundAgents.searchPlaceholder',
            'Search background agents'
          )}
          aria-label={t('auto.components.backgroundAgents.searchLabel', 'Search background agents')}
        />
        <button
          type="button"
          aria-label={t('auto.components.backgroundAgents.refresh', 'Refresh background agents')}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          onClick={reload}
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto scrollbar-sleek px-1 pb-2">
        {state.state === 'loading' ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('auto.components.backgroundAgents.loading', 'Loading background agents')}
          </div>
        ) : null}
        {state.state !== 'loading' && rows.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            {t('auto.components.backgroundAgents.empty', 'No background agents')}
          </div>
        ) : null}
        {rows.map((row) => (
          <BackgroundAgentRowView
            key={
              row.kind === 'chat'
                ? row.chat.sessionId
                : row.kind === 'terminal'
                  ? row.terminal.tabId
                  : row.vault.sessionId
            }
            row={row}
            onSelect={openRow}
          />
        ))}
      </div>
    </div>
  )
}
