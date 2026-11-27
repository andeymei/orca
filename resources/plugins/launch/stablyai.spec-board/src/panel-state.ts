// What the panel knows while it is open: the board the worker answered with, which tab is
// showing, which stage the rail is on, and the action that waits for its second press.
//
// The panel never builds a command line. It names an action and what it applies to — a work
// item, or a change; the worker resolves that into a command or a prompt, and only the worker
// can reach a terminal.

import { atom, plugin, read, set } from 'orca'
import type { Action, BoardPayload, ItemSourceKey, UnifiedStage } from './model'
import type { RefreshProgress } from './refresh-progress'

/** Which of the three tabs the panel shows. */
export type PanelTab = 'board' | 'map' | 'projects'

/** The board the worker last answered with; null until the first read lands. */
export const payload = atom<BoardPayload | null>(null)

/**
 * The tab that is open.
 *
 * It is kept per plugin, so the panel reopens on the tab the person left it on — and so the
 * plugin's own check can open a tab other than the first one.
 */
export const tab = atom<PanelTab>('spec-board.tab', 'board', { persist: 'plugin' })

/** The tab that is open. A stored value that names no tab falls back to the board. */
export function currentTab(): PanelTab {
  const value = read(tab)
  return value === 'map' || value === 'projects' ? value : 'board'
}

/** The project the map's commands run in; null means "the first project the board knows". */
export const mapProject = atom<string | null>(null)

/** The change the map's change-scoped commands act on; null means "none picked yet". */
export const mapChange = atom<string | null>(null)

/** The stage the rail is on; null means "the first stage that has work". */
export const stage = atom<UnifiedStage | null>(null)

/** Why the board could not be read, or an action could not be run. */
export const error = atom<{ code: string; message: string } | null>(null)

/** Whether a read of the board is in flight. */
export const busy = atom<boolean>(false)

/** Whether a refresh is in flight. */
export const refreshing = atom<boolean>(false)

/**
 * When the refresh in flight started; null when none is.
 *
 * It is persisted, because the refresh outlives the panel: the person closes the sidebar and
 * comes back to it, and the board still has to say that the agent is working.
 */
export const refreshStartedAt = atom<number | null>('spec-board.refresh-started-at', null, {
  persist: 'plugin'
})

/** What the agent last said about the refresh; null when it has not said. */
export const refreshProgress = atom<RefreshProgress | null>(null)

/**
 * The project the refresh in flight is about; null when the refresh is the whole board.
 *
 * It is persisted, like the start of the refresh: the refresh outlives the panel, and a person who
 * comes back to it should be told which project the agent is working on.
 */
export const refreshTarget = atom<string | null>('spec-board.refresh-target', null, {
  persist: 'plugin'
})

/** Whether the refresh has waited longer than it may. */
export const refreshTimedOut = atom<boolean>(false)

/** What the last refresh did: the agent the worker launched to write a new snapshot. */
export const refreshFeedback = atom<string | null>(null)

/**
 * Why the last refresh could not be started.
 *
 * It is its own failure, not the board's: a board that could not be read stays unread, and a
 * refresh does not read the board.
 */
export const refreshError = atom<{ code: string; message: string } | null>(null)

/** The action that waits for its second press. */
export const pendingAction = atom<{ scope: string; actionId: string } | null>(null)

/** What the last action on each button did, by the scope the press was filed under. */
export const feedback = atom<Record<string, string>>({})

/**
 * The action each scope has sent out, and the read it was sent after.
 *
 * A press that runs an agent is not undone by pressing again: the second press starts a second
 * agent. So the panel remembers what it sent, and the button says so until the board is read
 * again — the read is the only sign the panel has that the work may have moved on.
 *
 * The record is filed under the scope *and* the action: sending another action of the same card
 * does not clear the one that is still out.
 */
export const dispatched = atom<Record<string, { at: number }>>({})

/**
 * The key a dispatch is filed under.
 *
 * The scope and the action are joined by a character no scope holds, so one action's record can
 * never be mistaken for another's.
 */
export function dispatchKey(scope: string, actionId: string): string {
  return `${scope}\u0000${actionId}`
}

/**
 * How many times the board has been read.
 *
 * A dispatch remembers the number it happened at, so a button can tell that the board has been
 * read again since — the only signal the panel has that the work may have moved on.
 */
let boardReads = 0

/** The number of the read the board on screen came from. */
export function readNumber(): number {
  return boardReads
}

/** How long a mutating action waits for its second press. */
const CONFIRM_WINDOW_MS = 3000

/** The timer that takes the confirmation back, so the button asks again. */
let confirmTimer: ReturnType<typeof setTimeout> | null = null

/** What one panel run knows about the reads it asked for. */
type BoardReads = {
  /** How many are in flight; the panel is busy while any of them is. */
  inFlight: number
  /** The number of the last read that was asked for. */
  last: number
  /** The number of the read whose answer is on screen. */
  applied: number
  /** Set when the panel closes: a read that lands afterwards has nothing to say. */
  closed: boolean
}

/** The code the host refused with; a host that refused without one still gets a name. */
function codeOf(thrown: unknown): string {
  if (typeof thrown === 'object' && thrown !== null && 'code' in thrown) {
    const code = thrown.code
    if (typeof code === 'string' && code !== '') {
      return code
    }
  }
  return 'unknown'
}

/** What the host said, in the words a person reads. */
function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown)
}

/**
 * Reads the board again. Every read carries a number: an answer older than the one already on
 * screen is dropped, so two reads in flight cannot land out of order and overwrite each other.
 */
async function loadBoard(reads: BoardReads): Promise<void> {
  const number = ++reads.last
  reads.inFlight += 1
  set(busy, true)
  try {
    const answer = await plugin.request('board.get')
    if (reads.closed || number < reads.applied) {
      return
    }
    reads.applied = number
    // The board on screen is a new one: a button that waits for a read can wait for this one.
    boardReads += 1
    set(payload, answer)
    set(error, null)
    // The snapshot that just landed is newer than the refresh that was waiting for it: the
    // refresh has come back, and the bar has nothing left to say.
    const startedAt = read(refreshStartedAt)
    const landed = answer.sources.agentAt
    if (startedAt !== null && landed !== null && landed >= startedAt) {
      clearRefresh()
    }
  } catch (thrown) {
    if (reads.closed || number < reads.applied) {
      return
    }
    reads.applied = number
    set(error, { code: codeOf(thrown), message: messageOf(thrown) })
  } finally {
    reads.inFlight -= 1
    if (reads.inFlight === 0 && !reads.closed) {
      set(busy, false)
    }
  }
}

/**
 * The reads of one panel run: how to ask for the board, and how to close them.
 *
 * The bookkeeping belongs to the run that asked for it. A read that hung while its panel closed
 * must not leave the next panel busy forever — and must not write to it either.
 */
export function newBoardReads(): { load: () => Promise<void>; close: () => void } {
  const reads: BoardReads = { inFlight: 0, last: 0, applied: 0, closed: false }
  const load = (): Promise<void> => loadBoard(reads)
  currentLoad = load
  return {
    load,
    close: () => {
      reads.closed = true
      stopSnapshotWatch()
      if (currentLoad === load) {
        currentLoad = null
      }
    }
  }
}

/** How often, and for how long, the panel looks for the snapshot a refresh asked for. */
const SNAPSHOT_WATCH_INTERVAL_MS = 5_000
const SNAPSHOT_WATCH_MS = 15 * 60 * 1000

/** The open panel's read, and the timer that looks for the snapshot a refresh asked for. */
let currentLoad: (() => Promise<void>) | null = null
let snapshotWatch: ReturnType<typeof setTimeout> | null = null

function stopSnapshotWatch(): void {
  if (snapshotWatch !== null) {
    clearTimeout(snapshotWatch)
    snapshotWatch = null
  }
}

/**
 * Looks for the snapshot a refresh asked for.
 *
 * The worker's watcher posts `board.changed` when the snapshot lands, but Orca reaps an idle
 * worker and the agent can take minutes: the panel would then never hear about it. So it looks
 * itself, until the snapshot changes or the wait runs out.
 */
function watchForSnapshot(before: number | null): void {
  stopSnapshotWatch()
  const load = currentLoad
  if (load === null) {
    return
  }
  const deadline = Date.now() + SNAPSHOT_WATCH_MS
  const tick = async (): Promise<void> => {
    snapshotWatch = null
    if (Date.now() >= deadline) {
      set(refreshTimedOut, true)
      return
    }
    await load()
    const landed = read(payload)?.sources.agentAt ?? null
    if (landed !== null && landed !== before) {
      return
    }
    snapshotWatch = setTimeout(() => void tick(), SNAPSHOT_WATCH_INTERVAL_MS)
  }
  snapshotWatch = setTimeout(() => void tick(), SNAPSHOT_WATCH_INTERVAL_MS)
}

/**
 * Takes the refresh's state away.
 *
 * The board has its new data, so the bar has nothing left to say.
 */
export function clearRefresh(): void {
  set(refreshStartedAt, null)
  set(refreshProgress, null)
  set(refreshTimedOut, false)
  set(refreshTarget, null)
}

/** What the agent said about the refresh it is doing. */
export function applyRefreshProgress(progress: RefreshProgress | null): void {
  set(refreshProgress, progress)
}

/**
 * Asks the worker how far the refresh has come.
 *
 * A panel that opens while the agent is working knows nothing yet: the worker posts the
 * progress when it changes, and this asks for the one that is already there. A worker that
 * cannot answer knows nothing either — the bar then says no number, which is true.
 */
export async function askRefreshProgress(): Promise<void> {
  try {
    const answer = await plugin.request('board.progress')
    set(refreshProgress, answer.progress)
  } catch {
    // The progress is not the board: a worker that cannot answer it does not fail the refresh.
  }
}

/** What the card says after its action ran: which channel took it, and which agent. */
function feedbackOf(answer: { kind: 'terminal' | 'agent'; agent?: string }): string {
  if (answer.kind === 'terminal') {
    return '已在终端打开'
  }
  // The worker names the agent it launched; an answer without a name says only that one did.
  return `已派发给 ${answer.agent ?? 'agent'}`
}

/**
 * What a press on a button names: the action, the project it runs in, and what it applies to.
 * A card's press names a work item; the map's press names a change, or nothing at all.
 */
export type ActionPress = {
  /** Where the press is filed: the item's id, or the map's own key. */
  scope: string
  projectId: string
  action: Action
  /** The work item the action belongs to; a command of the map's palette names none. */
  itemId?: string
  /** The change a change-scoped command acts on. */
  changeId?: string
}

/**
 * The request the worker gets: what the panel names, never a command. A field the press does
 * not carry is left out, so the request says exactly what it means.
 */
function requestOf(press: ActionPress): {
  projectId: string
  actionId: string
  itemId?: string
  changeId?: string
} {
  const request: { projectId: string; actionId: string; itemId?: string; changeId?: string } = {
    projectId: press.projectId,
    actionId: press.action.id
  }
  if (press.itemId !== undefined) {
    request.itemId = press.itemId
  }
  if (press.changeId !== undefined) {
    request.changeId = press.changeId
  }
  return request
}

/** Runs one action: the panel names it, the worker resolves it into a command or a prompt. */
async function run(press: ActionPress): Promise<void> {
  // The callout describes the latest attempt: a new action clears the failure of the last one.
  set(error, null)
  try {
    const answer = await plugin.request('action.run', requestOf(press))
    set(feedback, { ...read(feedback), [press.scope]: feedbackOf(answer) })
    // The action is out: pressing the same button again would start a second one, so the button
    // says so until the board is read again.
    set(dispatched, {
      ...read(dispatched),
      [dispatchKey(press.scope, press.action.id)]: { at: readNumber() }
    })
  } catch (thrown) {
    set(error, { code: codeOf(thrown), message: messageOf(thrown) })
  }
}

/**
 * Asks the worker to launch the agent that writes a new snapshot.
 *
 * The panel does not scan anything itself and does not read the setting: the worker is the source
 * of the agent it launched, because the setting can change between the panel's read and the
 * launch. The board does not change when the request resolves — the agent scans, writes
 * `board.json`, and the worker's watcher posts `board.changed`, which reads the board again.
 */
export async function refreshBoard(): Promise<void> {
  // The refresh's own failure is its own: a board that could not be read stays unread, because a
  // refresh does not read the board.
  set(refreshError, null)
  set(refreshFeedback, null)
  set(refreshing, true)
  const before = read(payload)?.sources.agentAt ?? null
  try {
    const answer = await plugin.request('board.refresh')
    set(refreshFeedback, `已派发 ${answer.agent ?? 'agent'} 刷新`)
    // The refresh is now running, and it outlives the button: the bar says so until the
    // snapshot lands, however long the agent takes.
    const startedAt = Date.now()
    set(refreshStartedAt, startedAt)
    set(refreshProgress, null)
    set(refreshTimedOut, false)
    set(refreshTarget, null)
    watchForSnapshot(before)
  } catch (thrown) {
    set(refreshError, { code: codeOf(thrown), message: messageOf(thrown) })
    // A refusal because another refresh is running is not this refresh's failure: the running one
    // still has its bar.
    if (codeOf(thrown) !== 'conflict') {
      clearRefresh()
    }
  } finally {
    set(refreshing, false)
  }
}

/**
 * Asks the worker to refresh one project.
 *
 * A project on this machine is read by the worker itself, so the answer comes back with the work
 * already done and there is nothing to wait for. A project on another host is collected by an
 * agent, and the board waits for the snapshot to land — the bar says which project it is on.
 */
export async function refreshProject(projectId: string, name: string): Promise<void> {
  set(refreshError, null)
  set(refreshFeedback, null)
  set(refreshing, true)
  try {
    const answer = await plugin.request('board.refreshProject', { projectId })
    if (answer.kind === 'local') {
      // The worker read it here and put it in the snapshot: the work is done.
      set(refreshFeedback, `已刷新 ${name}`)
      return
    }
    set(refreshFeedback, `已派发 ${answer.agent ?? 'agent'} 刷新 ${name}`)
    const startedAt = Date.now()
    set(refreshStartedAt, startedAt)
    set(refreshProgress, null)
    set(refreshTimedOut, false)
    set(refreshTarget, name)
    watchForSnapshot(read(payload)?.sources.agentAt ?? null)
  } catch (thrown) {
    set(refreshError, { code: codeOf(thrown), message: messageOf(thrown) })
    if (codeOf(thrown) !== 'conflict') {
      clearRefresh()
    }
  } finally {
    set(refreshing, false)
  }
}

/**
 * Opens one file of a work item in an editor tab of Orca's window.
 *
 * The panel names the item and which of its files; the worker derives the path from the item's
 * own facts. A refusal is the board's to show: the callout above the tabs says what could not be
 * opened.
 */
export async function openSource(itemId: string, sourceKey: ItemSourceKey): Promise<void> {
  set(error, null)
  try {
    await plugin.request('source.open', { itemId, sourceKey })
  } catch (thrown) {
    set(error, { code: codeOf(thrown), message: messageOf(thrown) })
  }
}

/** Cancels the confirmation that is waiting, so nothing is pending any more. */
export function stopWaiting(): void {
  if (confirmTimer !== null) {
    clearTimeout(confirmTimer)
    confirmTimer = null
  }
  set(pendingAction, null)
}

/**
 * Starts watching for the snapshot a refresh in flight is waiting for.
 *
 * A panel that opens while the agent is working knows nothing about the watch the earlier panel
 * started: the watch dies with it, and the bar would sit there until the app restarts.
 */
export function resumeRefreshWatch(): void {
  if (read(refreshStartedAt) === null) {
    return
  }
  watchForSnapshot(read(payload)?.sources.agentAt ?? null)
}

/** Asks for the second press: the button asks, and the press within the window runs the action. */
function ask(scope: string, actionId: string): void {
  set(pendingAction, { scope, actionId })
  if (confirmTimer !== null) {
    clearTimeout(confirmTimer)
  }
  confirmTimer = setTimeout(() => {
    confirmTimer = null
    set(pendingAction, null)
  }, CONFIRM_WINDOW_MS)
}

/** What a press on an action's button does: run it, or ask for the second press first. */
export function pressAction(press: ActionPress): void {
  // An action that is already out is not sent again: the second press would start a second
  // agent, and the board has not been read since the first one.
  const sent = read(dispatched)[dispatchKey(press.scope, press.action.id)]
  if (sent !== undefined && sent.at === readNumber()) {
    return
  }
  const waiting = read(pendingAction)
  const asked =
    waiting !== null && waiting.scope === press.scope && waiting.actionId === press.action.id
  if (press.action.mutates && !asked) {
    ask(press.scope, press.action.id)
    return
  }
  stopWaiting()
  void run(press)
}
