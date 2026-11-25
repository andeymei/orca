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

/** How long a mutating action waits for its second press. */
const CONFIRM_WINDOW_MS = 3000

/** The timer that takes the confirmation back, so the button asks again. */
let confirmTimer: ReturnType<typeof setTimeout> | null = null

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

/** Reads the board again. */
export async function load(): Promise<void> {
  set(busy, true)
  try {
    set(payload, await plugin.request('board.get'))
    set(error, null)
  } catch (thrown) {
    set(error, { code: codeOf(thrown), message: messageOf(thrown) })
  } finally {
    set(busy, false)
  }
}

/** Runs one action: the panel names it, the worker resolves it into a command or a prompt. */
async function run(item: WorkItem, action: Action): Promise<void> {
  try {
    await plugin.request('action.run', {
      projectId: item.projectId,
      actionId: action.id,
      itemId: item.id
    })
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
