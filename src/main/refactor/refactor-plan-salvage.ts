import {
  buildRefactorPlan,
  type RefactorPlanInput,
  type RefactorPlanResult
} from './refactor-plan-builder'
import { refactorPathKey } from './refactor-path-rules'

/**
 * The plan of a turn that was cut off.
 *
 * Why it exists: the agent writes its proposals before its index, so a turn that ran out of time
 * has the changes on disk and no manifest. The plan builder rebuilds them from the scratch tree,
 * and the work is worth more than the reason the turn stopped.
 */
export async function salvageRefactorPlan(input: {
  /** The plan's own input, without the manifest the interrupted turn never wrote. */
  plan: Omit<RefactorPlanInput, 'manifest'>
  /** The keys of the files the agent wrote in full; empty when it wrote none. */
  completedWriteKeys: ReadonlySet<string>
}): Promise<RefactorPlanResult> {
  // Why an empty set filters nothing: the tracker only knows about the writes whose tool result
  // came back, and a set that is empty says the turn wrote nothing — not that every write is
  // half a file. Dropping everything on that reading would throw the work away again.
  const confirmed = input.completedWriteKeys.size > 0 ? input.completedWriteKeys : null
  return buildRefactorPlan({
    ...input.plan,
    manifest: null,
    scratchFiles: (proposalId, relativePath) =>
      confirmed === null || confirmed.has(refactorPathKey(`${proposalId}/${relativePath}`))
        ? input.plan.scratchFiles(proposalId, relativePath)
        : Promise.resolve(null)
  })
}
