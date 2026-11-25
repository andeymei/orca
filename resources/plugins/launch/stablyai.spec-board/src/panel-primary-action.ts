// Which action a card leads with.
//
// The stage was derived by the worker and arrives in the payload; choosing which of the buttons
// that already exist to promote is a presentation rule, so it lives here, in the panel. Moving it
// into the worker would change the payload's shape (`WorkItem`) and the worker's own tests, for
// the same rule.

import type { Action, UnifiedStage, WorkItem } from './model'

/** The action each stage waits for: the step the work in that stage is at. */
const PREFERRED_BY_STAGE: Readonly<Record<UnifiedStage, string>> = {
  proposal: 'superpowers.brainstorm',
  design: 'superpowers.brainstorm',
  plan: 'superpowers.plan',
  implement: 'superpowers.execute',
  validate: 'openspec.validate',
  archive: 'openspec.archive'
}

/**
 * The action the card leads with: the one its stage prefers, or the first one it offers when that
 * one is not there — an OpenSpec-only card has no Superpowers skill, a Superpowers-only card has
 * no OpenSpec command.
 */
export function primaryAction(item: WorkItem): Action | null {
  const preferred = PREFERRED_BY_STAGE[item.stage]
  const found = item.actions.find((action) => action.id === preferred)
  return found ?? item.actions.at(0) ?? null
}

/** The actions the card keeps behind 更多: everything but the one it leads with. */
export function otherActions(item: WorkItem): Action[] {
  const primary = primaryAction(item)
  return item.actions.filter((action) => action.id !== primary?.id)
}
