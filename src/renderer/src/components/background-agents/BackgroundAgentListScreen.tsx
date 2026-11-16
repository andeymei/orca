import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store/index'
import { selectKnownWorktreeById } from '@/store/workspaces/selection/known-worktree-selection'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import {
  buildBackgroundAgentListRows,
  countBackgroundAgentListRows,
  groupBackgroundAgentListRows,
  type BackgroundAgentListRow
} from './background-agent-list-rows'
import { BackgroundAgentRowView } from './BackgroundAgentRow'
import { useBackgroundAgentDispatch } from './use-background-agent-dispatch'
import {
  refreshBackgroundAgentRoster,
  useBackgroundAgentRosterRefresh
} from './use-background-agent-roster-refresh'

/** The second Ctrl+X has to follow the first one within this window. */
const CONFIRM_WINDOW_MS = 3000
/** How often the activity lines are read again. */
const DETAIL_REFRESH_INTERVAL_MS = 2000
/** How often the elapsed column is recomputed. */
const ELAPSED_TICK_INTERVAL_MS = 1000

/** A command that waits for its second Ctrl+X. */
type PendingCommand = { id: string; kind: 'stop' | 'delete'; at: number }

/**
 * The list of Claude Code's background agents.
 *
 * The roster is the CLI's own list; the panel only adds the line of activity under each name and
 * the way to act on it. The arrow keys walk the rows the way the CLI's list does, Enter opens the
 * agent, and the composer at the bottom starts a new one.
 */
export function BackgroundAgentListScreen(): React.JSX.Element {
  const t = useTranslate()
  const rootRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLInputElement>(null)
  const [composer, setComposer] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingCommand, setPendingCommand] = useState<PendingCommand | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const agents = useAppStore((state) => state.backgroundAgentsAgents)
  const details = useAppStore((state) => state.backgroundAgentsDetails)
  const status = useAppStore((state) => state.backgroundAgentsStatus)
  const failureMessage = useAppStore((state) => state.backgroundAgentsMessage)
  const openBackgroundAgent = useAppStore((state) => state.openBackgroundAgent)
  const { dispatch, dispatchPrompt, cancelOpeningDispatch } = useBackgroundAgentDispatch()
  // Why: the panel lists this machine's agents, so a workspace on another host needs saying out loud.
  const listsThisMachineOnly = useAppStore((state) => {
    const worktree = selectKnownWorktreeById(state, state.activeWorktreeId)
    return (worktree?.hostId ?? LOCAL_EXECUTION_HOST_ID) !== LOCAL_EXECUTION_HOST_ID
  })

  const rows = useMemo(() => buildBackgroundAgentListRows(agents, details), [agents, details])
  const groups = useMemo(() => groupBackgroundAgentListRows(rows), [rows])
  const counts = useMemo(() => countBackgroundAgentListRows(rows), [rows])
  const selectableRows = useMemo(
    () => [...groups.working, ...groups.needsInput, ...groups.completed],
    [groups]
  )
  const selectedIndex = Math.max(
    0,
    selectedId === null ? 0 : selectableRows.findIndex((row) => row.id === selectedId)
  )
  const selectedRow = selectableRows[selectedIndex] ?? null

  useBackgroundAgentRosterRefresh()

  useEffect(() => {
    // Why: the elapsed column has no reader while the window is hidden.
    return installWindowVisibilityInterval({
      run: () => setNow(Date.now()),
      intervalMs: ELAPSED_TICK_INTERVAL_MS
    })
  }, [])

  // The fast layer: only the known agents are asked for, because a state file nobody knows about
  // cannot be read.
  useEffect(() => {
    const ids = agents.map((agent) => agent.id)
    let cancelled = false
    const readDetails = async (): Promise<void> => {
      if (cancelled || ids.length === 0) {
        return
      }
      try {
        const read = await window.api.claudeAgents.readDetails(ids)
        if (!cancelled) {
          useAppStore.getState().publishBackgroundAgentDetails(read)
        }
      } catch {
        // A state file that cannot be read leaves the row without an activity line.
      }
    }
    // Why: the poll pauses while the window is hidden and reads again when it comes back.
    const stop = installWindowVisibilityInterval({
      run: () => {
        void readDetails()
      },
      intervalMs: DETAIL_REFRESH_INTERVAL_MS
    })
    return () => {
      cancelled = true
      stop()
    }
  }, [agents])

  const moveSelection = (delta: 1 | -1): void => {
    if (selectableRows.length === 0) {
      return
    }
    const from = selectedIndex
    const next = Math.min(Math.max(from + delta, 0), selectableRows.length - 1)
    setSelectedId(selectableRows[next].id)
  }

  const activateOrDispatch = async (): Promise<void> => {
    const prompt = composer.trim()
    if (prompt !== '') {
      // Why: the prompt stays in the box while the agent opens, and a refused dispatch keeps it
      // so the user can try again without typing it twice.
      if (await dispatchPrompt(prompt)) {
        setComposer('')
      }
      return
    }
    if (selectedRow) {
      openBackgroundAgent(selectedRow.id)
    }
  }

  const runSelectedCommand = async (): Promise<void> => {
    const row = selectedRow
    if (!row) {
      return
    }
    // Why: a finished agent has nothing left to stop, so the second Ctrl+X deletes it instead.
    const kind = row.section === 'completed' ? 'delete' : 'stop'
    const armed = pendingCommand
    if (
      armed &&
      armed.id === row.id &&
      armed.kind === kind &&
      Date.now() - armed.at < CONFIRM_WINDOW_MS
    ) {
      setPendingCommand(null)
      const result =
        kind === 'stop'
          ? await window.api.claudeAgents.stop({ id: row.id })
          : await window.api.claudeAgents.remove({ id: row.id })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      await refreshBackgroundAgentRoster()
      return
    }
    setPendingCommand({ id: row.id, kind, at: Date.now() })
  }

  const commandHint = (row: BackgroundAgentListRow): React.ReactNode => {
    if (!pendingCommand || pendingCommand.id !== row.id) {
      return null
    }
    // Why: a hint that outlives its window would offer a second Ctrl+X that only re-arms.
    if (now - pendingCommand.at >= CONFIRM_WINDOW_MS) {
      return null
    }
    return pendingCommand.kind === 'delete'
      ? `${t('auto.components.backgroundAgents.deleteConfirm', 'ctrl+x again to delete')} · ${t(
          'auto.components.backgroundAgents.deleteWarning',
          'Deleting an agent also deletes its worktree'
        )}`
      : t('auto.components.backgroundAgents.stopConfirm', 'ctrl+x again to stop')
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) {
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveSelection(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      void activateOrDispatch()
      return
    }
    if (event.ctrlKey && (event.key === 'x' || event.key === 'X')) {
      event.preventDefault()
      void runSelectedCommand()
      return
    }
    if (event.key === '/') {
      event.preventDefault()
      composerRef.current?.focus()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      // Why: the opening row says "esc to cancel", and a dispatch that starts anyway cannot be
      // taken back; a typed prompt can.
      if (dispatch?.state === 'opening') {
        cancelOpeningDispatch()
        return
      }
      if (composer !== '') {
        setComposer('')
        return
      }
      rootRef.current?.focus()
    }
  }

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      void activateOrDispatch()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (dispatch?.state === 'opening') {
        cancelOpeningDispatch()
        return
      }
      if (composer !== '') {
        setComposer('')
        return
      }
      rootRef.current?.focus()
    }
  }

  const handleDispatchRowKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && dispatch?.state === 'opening') {
      event.preventDefault()
      event.stopPropagation()
      cancelOpeningDispatch()
    }
  }

  const dispatchLabel =
    dispatch?.state === 'failed'
      ? (dispatch.message ??
        t('auto.components.backgroundAgents.error', 'Could not read the background agents'))
      : dispatch?.state === 'started'
        ? t('auto.components.backgroundAgents.dispatchStarted', 'started · {id}', {
            id: dispatch.agentId ?? ''
          })
        : t('auto.components.backgroundAgents.dispatching', 'opening… · esc to cancel')

  const renderSection = (
    label: string,
    sectionRows: BackgroundAgentListRow[]
  ): React.JSX.Element | null => {
    if (sectionRows.length === 0) {
      return null
    }
    return (
      <div role="group" aria-label={label} className="flex flex-col gap-0.5">
        <div className="px-2 pt-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        {sectionRows.map((row) => (
          <BackgroundAgentRowView
            key={row.id}
            row={row}
            selected={selectedRow?.id === row.id}
            onSelect={(picked) => openBackgroundAgent(picked.id)}
            now={now}
            hint={commandHint(row)}
          />
        ))}
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-testid="background-agents-list"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center justify-between gap-2 px-2 pt-2 text-2xs text-muted-foreground">
        <span>
          {t(
            'auto.components.backgroundAgents.counts',
            '{awaiting} awaiting input · {working} working · {completed} completed',
            {
              awaiting: counts.awaitingInput,
              working: counts.working,
              completed: counts.completed
            }
          )}
        </span>
      </div>
      {listsThisMachineOnly ? (
        <div
          data-testid="background-agents-local-only-notice"
          className="px-2 pt-1 text-2xs text-muted-foreground"
        >
          {t(
            'auto.components.backgroundAgents.localOnlyNotice',
            'This panel lists background agents running on this machine'
          )}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-sleek px-1 pb-2">
        {dispatch ? (
          <div
            role="status"
            data-testid="background-agent-dispatch-row"
            tabIndex={-1}
            onKeyDown={handleDispatchRowKeyDown}
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
              {dispatchLabel}
            </span>
          </div>
        ) : null}
        {status === 'loading' ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('auto.components.backgroundAgents.loading', 'Loading background agents')}
          </div>
        ) : null}
        {status === 'unsupported' ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            {t('auto.components.backgroundAgents.unsupported', 'Claude Code CLI not found')}
          </div>
        ) : null}
        {status === 'error' ? (
          <div className="py-6 text-center text-xs text-destructive">
            {t('auto.components.backgroundAgents.error', 'Could not read the background agents')}
            {failureMessage ? (
              <span className="block text-muted-foreground">{failureMessage}</span>
            ) : null}
          </div>
        ) : null}
        {status === 'ready' && rows.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            {t('auto.components.backgroundAgents.empty', 'No background agents')}
          </div>
        ) : null}
        <div
          role="listbox"
          aria-label={t('auto.components.backgroundAgents.title', 'Background agents')}
        >
          {renderSection(
            t('auto.components.backgroundAgents.workingSection', 'Working'),
            groups.working
          )}
          {renderSection(
            t('auto.components.backgroundAgents.needsInputSection', 'Needs input'),
            groups.needsInput
          )}
          {renderSection(
            t('auto.components.backgroundAgents.completedSection', 'Completed'),
            groups.completed
          )}
        </div>
      </div>
      <div className="border-t border-border px-2 py-2">
        <Input
          ref={composerRef}
          density="compact"
          value={composer}
          onChange={(event) => setComposer(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          placeholder={t(
            'auto.components.backgroundAgents.composerPlaceholder',
            'Describe a task for a new session'
          )}
          aria-label={t('auto.components.backgroundAgents.composerLabel', 'New background agent')}
        />
      </div>
      <div className="px-2 pb-2 text-2xs text-muted-foreground">
        {t(
          'auto.components.backgroundAgents.shortcuts',
          '↑↓ select · enter enter · ctrl+x stop · / search'
        )}
      </div>
    </div>
  )
}

export default BackgroundAgentListScreen
