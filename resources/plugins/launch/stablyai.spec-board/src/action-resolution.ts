// Resolves what a button press means.
//
// The panel names an action and, for a change-scoped command, the change it picked; it never
// names a command line. The worker turns that into the action to run and refuses anything it
// cannot resolve — which is the only path a project-derived value takes into a command.

import { findAction, frameworkActions, resolvePaletteAction } from './actions'
import type { Action, WorkItem } from './model'

/** What the panel sends: an action, and the item or the change it belongs to. */
export type ActionRequest = {
  projectId: string
  actionId: string
  itemId?: string
  changeId?: string
}

/** Why an action could not be resolved. */
export type ActionFailure =
  | 'unknown-item'
  | 'unknown-action'
  | 'needs-change-id'
  | 'unsafe-change-id'
  | 'placeholder-in-project-action'

export type ActionResolution = { ok: true; action: Action } | { ok: false; reason: ActionFailure }

/**
 * The action to run.
 *
 * With an item, the action is one of that item's own — the ones the worker derived and already
 * gated — and an item's action id that is not among them is refused. Without one, the action is
 * one of the project's palette, and a palette command that still names a change is resolved with
 * the change the panel picked.
 *
 * Both given, the item wins: an item's action is already concrete, so the change is not needed.
 */
export function resolveAction(input: {
  items: readonly WorkItem[]
  request: ActionRequest
  cliAvailable: boolean
}): ActionResolution {
  const { request } = input
  if (request.itemId !== undefined) {
    const item = input.items.find((entry) => entry.id === request.itemId)
    if (!item) {
      return { ok: false, reason: 'unknown-item' }
    }
    const action = findAction(item.actions, request.actionId)
    if (!action) {
      return { ok: false, reason: 'unknown-action' }
    }
    return { ok: true, action }
  }
  const palette = frameworkActions(input.cliAvailable)
  const action = findAction([...palette.openspec, ...palette.superpowers], request.actionId)
  if (!action) {
    return { ok: false, reason: 'unknown-action' }
  }
  const resolved = resolvePaletteAction(action, request.changeId)
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason }
  }
  return { ok: true, action: resolved.action }
}
