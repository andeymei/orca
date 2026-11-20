import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store/index'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import type { ClaudeAgentsScope } from '../../../../shared/claude-background-agents'
import {
  buildBackgroundAgentListRows,
  countBackgroundAgentListRows,
  groupBackgroundAgentListRows,
  type BackgroundAgentListRow
} from './background-agent-list-rows'
import { BackgroundAgentComposer } from './BackgroundAgentComposer'
import { BackgroundAgentEmptyState } from './BackgroundAgentEmptyState'
import { BackgroundAgentHostNotice } from './BackgroundAgentHostNotice'
import { BackgroundAgentRowView } from './BackgroundAgentRow'
import { useBackgroundAgentScopeMatcher } from './use-background-agent-scope-matcher'
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

/** Whether the field that has the focus holds a text selection of its own. */
function hasTextSelection(target: EventTarget & HTMLElement): boolean {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return target.selectionStart !== target.selectionEnd
  }
  return false
}

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
  // The roster follows the workspace's host: this machine's CLI, or a paired runtime's job files.
  const activeWorktreeId = useAppStore((state) => state.activeWorktreeId)
  const activeWorkspaceExecutionHostId = useAppStore(
    (state) => state.activeWorkspaceExecutionHostId
  )
  const scope = useMemo<ClaudeAgentsScope>(
    () => ({
      worktreeId: activeWorktreeId,
      executionHostId: activeWorkspaceExecutionHostId
    }),
    [activeWorktreeId, activeWorkspaceExecutionHostId]
  )
  const executionHostKind = parseExecutionHostId(activeWorkspaceExecutionHostId)?.kind ?? 'local'
  // Why read-only: opening an agent needs its remote PTY, and starting, stopping or deleting one
  // needs a one-shot remote command, neither of which this version has.
  const hostRosterIsReadOnly = executionHostKind === 'runtime'
  // Why: an SSH host cannot answer the listing at all, so this machine's roster is all there is.
  const hostNoticeKind = executionHostKind === 'local' ? null : executionHostKind

  // Why: the CLI lists this machine's agents, so the panel keeps the ones of the open workspace.
  // The scope follows the workspace, so switching projects swaps the roster.
  const inScope = useBackgroundAgentScopeMatcher()
  // The filter runs before the grouping, so the header counts the workspace's agents only.
  const rows = useMemo(
    () => buildBackgroundAgentListRows(agents, details).filter((row) => inScope(row.cwd)),
    [agents, details, inScope]
  )
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
    // Why: the CLI's prompt box is ready to type into the moment the screen opens; a read-only
    // host has no prompt, so the list itself takes the keys.
    if (hostRosterIsReadOnly) {
      rootRef.current?.focus()
      return
    }
    composerRef.current?.focus()
  }, [hostRosterIsReadOnly])

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
        // Why the scope: a paired host answers these from the details its listing already read.
        const read = await window.api.claudeAgents.readDetails(ids, scope)
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
  }, [agents, scope])

  const moveSelection = (delta: 1 | -1): void => {
    if (selectableRows.length === 0) {
      return
    }
    const from = selectedIndex
    const next = Math.min(Math.max(from + delta, 0), selectableRows.length - 1)
    setSelectedId(selectableRows[next].id)
  }

  const activateOrDispatch = async (): Promise<void> => {
    if (hostRosterIsReadOnly) {
      return
    }
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
    // Why: stopping or deleting an agent on another host has no command path in this version.
    if (!row || hostRosterIsReadOnly) {
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

  /** Opens the selected row, or dispatches the composed prompt. */
  const activate = (event: React.KeyboardEvent<HTMLElement>): void => {
    event.preventDefault()
    void activateOrDispatch()
  }

  /**
   * The actions the panel's keys trigger.
   *
   * The root, the rows and the composer run the same actions, so the behaviour does not depend on
   * where the focus happens to be.
   */
  const runPanelKey = (event: React.KeyboardEvent<HTMLElement>): boolean => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveSelection(event.key === 'ArrowDown' ? 1 : -1)
      return true
    }
    if (event.key === 'Enter') {
      activate(event)
      return true
    }
    if (event.ctrlKey && (event.key === 'x' || event.key === 'X')) {
      // Why: a selection in the composer is the user's own text, and the native cut has to win.
      if (hasTextSelection(event.currentTarget)) {
        return false
      }
      event.preventDefault()
      void runSelectedCommand()
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      // Why: the composer holds the user's own text, and clearing it is what they meant; the
      // placeholder row above carries the "esc to cancel" and cancels from its own handler.
      if (composer !== '') {
        setComposer('')
        return true
      }
      if (dispatch?.state === 'opening') {
        cancelOpeningDispatch()
        return true
      }
      rootRef.current?.focus()
      return true
    }
    return false
  }

  /** `/` sends the caret to the composer; in the composer it is an ordinary character. */
  const focusComposer = (event: React.KeyboardEvent<HTMLElement>): boolean => {
    if (event.key !== '/') {
      return false
    }
    event.preventDefault()
    composerRef.current?.focus()
    return true
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) {
      return
    }
    if (focusComposer(event)) {
      return
    }
    runPanelKey(event)
  }

  const handleRowKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === ' ') {
      // Why: the button's own activation would open the focused row, while the panel's keys act
      // on the selected one.
      activate(event)
      event.stopPropagation()
      return
    }
    if (focusComposer(event) || runPanelKey(event)) {
      event.stopPropagation()
    }
  }

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (runPanelKey(event)) {
      event.stopPropagation()
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
        t('auto.components.backgroundAgents.dispatchFailed', 'The agent could not be started'))
      : dispatch?.state === 'started'
        ? t('auto.components.backgroundAgents.dispatchStarted', 'started · {{id}}', {
            id: dispatch.agentId ?? ''
          })
        : dispatch?.state === 'cancelling'
          ? t('auto.components.backgroundAgents.dispatchingCancelling', 'cancelling…')
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
            disabled={hostRosterIsReadOnly}
            onSelect={(picked) => {
              if (!hostRosterIsReadOnly) {
                openBackgroundAgent(picked.id)
              }
            }}
            now={now}
            hint={commandHint(row)}
            onKeyDown={handleRowKeyDown}
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
            '{{awaiting}} awaiting input · {{working}} working · {{completed}} completed',
            {
              awaiting: counts.awaitingInput,
              working: counts.working,
              completed: counts.completed
            }
          )}
        </span>
      </div>
      <BackgroundAgentHostNotice hostKind={hostNoticeKind} />
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
        {status === 'ready' && rows.length === 0 ? <BackgroundAgentEmptyState /> : null}
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
      {hostRosterIsReadOnly ? null : (
        <BackgroundAgentComposer
          value={composer}
          onChange={(event) => setComposer(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          inputRef={composerRef}
        />
      )}
    </div>
  )
}

export default BackgroundAgentListScreen
