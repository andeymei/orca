// The places where the two frameworks' view of the same work disagree. The snapshot on disk
// carries facts only; the gaps are derived from them here, one rule per row of the spec's table.

import type { Gap, OpenspecFacts, SuperpowersFacts } from './model'

/** How far apart the two checklists have to be before the board calls it drift. */
const DRIFT_THRESHOLD = 0.3

/** One checklist: the boxes on one side of the card. */
type Checklist = { done: number; inProgress: number; total: number }

/** How much of a checklist is done, or null when there is no checklist to speak of. */
function completion(checklist: Checklist): number | null {
  return checklist.total > 0 ? checklist.done / checklist.total : null
}

/** Whether anyone has started the checklist at all. */
function started(checklist: Checklist): boolean {
  return checklist.done + checklist.inProgress > 0
}

/**
 * The gaps of one board item. `existingSpecCapabilities` are the capability directories the
 * project's `openspec/specs/` holds; without them the archived check cannot be made, so it is
 * not made.
 */
export function detectGaps(item: {
  openspec: OpenspecFacts | null
  superpowers: SuperpowersFacts | null
  existingSpecCapabilities?: readonly string[]
}): Gap[] {
  const { openspec, superpowers } = item
  const existingSpecCapabilities = item.existingSpecCapabilities
  const gaps: Gap[] = []

  // Work that has shipped is not work in flight: the four in-flight gaps would only be noise
  // there. What is still worth saying about finished work is what it left undone — a change
  // that still needs archiving, or a capability that never reached the specs.
  const inFlight = openspec?.stage !== 'archived' && superpowers?.stage !== 'done'

  if (inFlight && openspec && !superpowers) {
    gaps.push({
      code: 'openspec-only',
      severity: 'warning',
      message: '有 OpenSpec 变更，没有对应的 Superpowers 设计'
    })
  }
  if (inFlight && superpowers && !openspec) {
    gaps.push({
      code: 'superpowers-only',
      severity: 'warning',
      message: '有 Superpowers 设计或计划，没有对应的 OpenSpec 变更'
    })
  }

  if (inFlight && openspec && superpowers) {
    const tasks: Checklist = {
      done: openspec.tasksDone,
      inProgress: openspec.tasksInProgress,
      total: openspec.tasksTotal
    }
    const plan: Checklist = {
      done: superpowers.planDone,
      inProgress: superpowers.planInProgress,
      total: superpowers.planTotal
    }
    const taskCompletion = completion(tasks)
    const planCompletion = completion(plan)
    if (
      taskCompletion !== null &&
      planCompletion !== null &&
      started(tasks) &&
      started(plan) &&
      Math.abs(taskCompletion - planCompletion) > DRIFT_THRESHOLD
    ) {
      gaps.push({
        code: 'progress-drift',
        severity: 'warning',
        message: `进度已经漂移：OpenSpec 任务 ${tasks.done}/${tasks.total}，Superpowers 计划 ${plan.done}/${plan.total}`
      })
    }
  }

  if (inFlight && openspec?.hasTasks && !openspec.hasDesign) {
    gaps.push({
      code: 'no-design',
      severity: 'info',
      message: '有 tasks.md，但缺少 design.md'
    })
  }

  // Outside the gate on purpose: a plan that is done while its change still sits in `changes/`
  // with every task ticked is a change that still needs archiving, and that is worth saying.
  if (
    openspec &&
    openspec.stage !== 'archived' &&
    openspec.hasTasks &&
    openspec.tasksTotal > 0 &&
    openspec.tasksDone === openspec.tasksTotal
  ) {
    gaps.push({
      code: 'tasks-complete-not-archived',
      severity: 'info',
      message: 'tasks.md 全部勾完，但变更还在 changes/ 里没有归档'
    })
  }

  if (openspec?.stage === 'archived' && existingSpecCapabilities) {
    const missing = openspec.capabilities.filter(
      (capability) => !existingSpecCapabilities.includes(capability)
    )
    if (missing.length > 0) {
      gaps.push({
        code: 'archived-spec-stale',
        severity: 'info',
        message: `已归档的能力还没有进入 openspec/specs/：${missing.join('、')}`
      })
    }
  }

  return gaps
}
