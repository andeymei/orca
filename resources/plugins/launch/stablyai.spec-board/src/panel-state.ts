// What the panel knows while it is open: the board the worker answered with, which tab is
// showing, which stage the rail is on, and the action that waits for its second press.
//
// The panel never builds a command line. It names an action and the item it belongs to; the
// worker resolves that into a command or a prompt, and only the worker can reach a terminal.

import { atom, plugin, read, set } from 'orca'
import type { Action, BoardPayload, UnifiedStage, WorkItem } from './model'

/** Which of the three tabs the panel shows. */
export type PanelTab = 'board' | 'map' | 'projects'

/** The board the worker last answered with; null until the first read lands. */
export const payload = atom<BoardPayload | null>(null)

/** The tab that is open. */
export const tab = atom<PanelTab>('board')

/** The stage the rail is on; null means "the first stage that has work". */
export const stage = atom<UnifiedStage | null>(null)

/** Why the board could not be read, or an action could not be run. */
export const error = atom<{ code: string; message: string } | null>(null)

/** Whether a read of the board is in flight. */
export const busy = atom<boolean>(false)

/** The action that waits for its second press. */
export const pendingAction = atom<{ itemId: string; actionId: string } | null>(null)

/** What the last action on each card did, by the card's item id. */
export const feedback = atom<Record<string, string>>({})

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
    set(payload, answer)
    set(error, null)
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
  return {
    load: () => loadBoard(reads),
    close: () => {
      reads.closed = true
    }
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

/** Runs one action: the panel names it, the worker resolves it into a command or a prompt. */
async function run(item: WorkItem, action: Action): Promise<void> {
  // The callout describes the latest attempt: a new action clears the failure of the last one.
  set(error, null)
  try {
    const answer = await plugin.request('action.run', {
      projectId: item.projectId,
      actionId: action.id,
      itemId: item.id
    })
    set(feedback, { ...read(feedback), [item.id]: feedbackOf(answer) })
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

/** Asks for the second press: the button asks, and the press within the window runs the action. */
function ask(itemId: string, actionId: string): void {
  set(pendingAction, { itemId, actionId })
  if (confirmTimer !== null) {
    clearTimeout(confirmTimer)
  }
  confirmTimer = setTimeout(() => {
    confirmTimer = null
    set(pendingAction, null)
  }, CONFIRM_WINDOW_MS)
}

/** What a press on an action's button does: run it, or ask for the second press first. */
export function pressAction(item: WorkItem, action: Action): void {
  const waiting = read(pendingAction)
  const asked = waiting !== null && waiting.itemId === item.id && waiting.actionId === action.id
  if (action.mutates && !asked) {
    ask(item.id, action.id)
    return
  }
  stopWaiting()
  void run(item, action)
}
