// The one place that decides which unified stage a work item is in. The snapshot on disk carries
// facts only; the stage is derived from them here, in the order the spec's table lists.

import type { OpenspecFacts, SuperpowersFacts, UnifiedStage } from './model'

/** The facts a stage is derived from. */
type StageFacts = {
  openspec: OpenspecFacts | null
  superpowers: SuperpowersFacts | null
}

/** A checklist the work item actually has, and how far along it is. */
type Progress = { done: number; inProgress: number; total: number }

/** The checklists that exist: a `tasks.md` on one side, a plan file on the other. */
function progressPairs(facts: StageFacts): Progress[] {
  const pairs: Progress[] = []
  if (facts.openspec?.hasTasks) {
    pairs.push({
      done: facts.openspec.tasksDone,
      inProgress: facts.openspec.tasksInProgress,
      total: facts.openspec.tasksTotal
    })
  }
  if (facts.superpowers?.plan) {
    pairs.push({
      done: facts.superpowers.planDone,
      inProgress: facts.superpowers.planInProgress,
      total: facts.superpowers.planTotal
    })
  }
  return pairs
}

export function deriveStage(facts: StageFacts): UnifiedStage {
  if (facts.openspec?.stage === 'archived') {
    return 'archive'
  }

  const pairs = progressPairs(facts)
  // A checklist with no boxes at all carries no progress information: it neither advances the
  // stage nor holds it back from 'validate'.
  const informative = pairs.filter((pair) => pair.total > 0)
  if (informative.length > 0 && informative.every((pair) => pair.done === pair.total)) {
    return 'validate'
  }
  if (informative.some((pair) => pair.done + pair.inProgress > 0)) {
    return 'implement'
  }
  if (pairs.length > 0 && pairs.every((pair) => pair.done === 0 && pair.inProgress === 0)) {
    return 'plan'
  }

  // No checklist on either side, so the table's design row is the one that applies.
  if (facts.openspec?.hasDesign || facts.superpowers?.designSpec) {
    return 'design'
  }
  return 'proposal'
}
