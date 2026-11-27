// Which action a card leads with.
//
// The stage says what the work is waiting for, and the leading button is the step that moves it
// on: a card in the design stage leads with the plan, because a plan is what turns a design into
// work. A card in the proposal stage has no design yet, so it leads with the one that writes it.
//
// Every stage names its step for both frameworks, because a card may carry only one of them: an
// OpenSpec change has no Superpowers plan, and its own step is the one that finishes it. A stage
// whose step this work item cannot take leads with the first action the card offers — a button
// that does not move the work on says nothing about where the work is, and a card with no action
// at all has no button. The rest of the actions stay behind 更多.
//
// One step comes before its stage: a change whose tasks are all ticked is ready to be
// archived, and archiving is what moves it on. Such a card leads with 归档 rather than with
// the check that comes before it, and that check stays behind 更多.
//
// The verified stage names one step: a card is verified on the Superpowers side, and 收尾 is
// what it waits for; the OpenSpec side's 归档 stays behind 更多.
//
// The stage was derived by the worker and arrives in the payload; choosing which of the buttons
// that already exist to promote is a presentation rule, so it lives here, in the panel. Moving it
// into the worker would change the payload's shape (`WorkItem`) and the worker's own tests, for
// the same rule.

import type { Action, UnifiedStage, WorkItem } from './model'

/** The actions each stage waits for, in the order they fit the work. */
const PREFERRED_BY_STAGE: Readonly<Record<UnifiedStage, readonly string[]>> = {
  // 提案：还没有设计，写设计才进下一栏；OpenSpec 那边是把这个变更补齐。
  proposal: ['superpowers.brainstorm', 'openspec.complete'],
  // 设计：设计有了，计划还没有，写实施计划才进下一栏。
  design: ['superpowers.plan', 'openspec.complete'],
  // 计划：计划有了，还没开工，执行它。
  plan: ['superpowers.execute', 'openspec.implement'],
  // 实现：开工了，接着做完。
  implement: ['superpowers.execute', 'openspec.implement'],
  // 校验：做完了，校验它；两边各有一套说法，OpenSpec 的先。
  validate: ['openspec.validate', 'superpowers.verify'],
  // 已验证：验证过了，下一步是收尾；再验证一轮仍然可以，验证因此留在「更多」里。
  verified: ['superpowers.finish'],
  // 归档：已经归档，没有什么可推进的了——能看的只是它归档了什么。
  archive: ['openspec.show', 'superpowers.review']
}

/**
 * Whether the change is ready to be archived.
 *
 * The facts say that its tasks are all ticked: a change whose tasks are done is `validated`,
 * and an archived one is `archived` — so a validated one is still in `changes/`. The stage says
 * that the rest of the work is done too: a change whose tasks are done while the other side's
 * plan is not is not ready, because the work item as a whole is still in flight and the drift
 * between the two is what the board reports.
 */
export function archiveReady(item: WorkItem): boolean {
  return item.stage === 'validate' && item.openspec?.stage === 'validated'
}

/**
 * The action the card leads with: the one that moves the work on, or the first one the card
 * offers when it cannot take that step — a card with no action at all leads with nothing.
 */
export function primaryAction(item: WorkItem): Action | null {
  // A change whose tasks are all ticked is waiting to be archived, and archiving is the step
  // that moves it on. The check that comes before it stays behind 更多: it does not move the
  // work anywhere, and a card cannot lead with both.
  if (archiveReady(item)) {
    const archive = item.actions.find((action) => action.id === 'openspec.archive')
    if (archive) {
      return archive
    }
  }
  for (const id of PREFERRED_BY_STAGE[item.stage]) {
    const found = item.actions.find((action) => action.id === id)
    if (found) {
      return found
    }
  }
  return item.actions.at(0) ?? null
}

/** The actions the card keeps behind 更多: everything but the one it leads with. */
export function otherActions(item: WorkItem): Action[] {
  const primary = primaryAction(item)
  return item.actions.filter((action) => action.id !== primary?.id)
}
