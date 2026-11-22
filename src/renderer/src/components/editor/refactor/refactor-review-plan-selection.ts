import type {
  RefactorFileProposal,
  RefactorHunk,
  RefactorPlan,
  RefactorProposal
} from '../../../../../shared/refactor/refactor-types'
import { refactorHunksOfProposal } from './refactor-review-store'

/** The hunk the right pane shows, and the proposal and file it belongs to. */
export type SelectedHunk = {
  proposal: RefactorProposal
  file: RefactorFileProposal
  hunk: RefactorHunk
}

/** The hunk the right pane shows, and the proposal and file it belongs to. */
export function findHunk(plan: RefactorPlan, hunkId: string | null): SelectedHunk | null {
  if (!hunkId) {
    return null
  }
  for (const proposal of plan.proposals) {
    for (const file of proposal.files) {
      const hunk = file.hunks.find((candidate) => candidate.id === hunkId)
      if (hunk) {
        return { proposal, file, hunk }
      }
    }
  }
  return null
}

/** The first change of the plan, so the right pane has something to show. */
export function firstHunkOf(plan: RefactorPlan): SelectedHunk | null {
  for (const proposal of plan.proposals) {
    for (const file of proposal.files) {
      const hunk = file.hunks[0]
      if (hunk) {
        return { proposal, file, hunk }
      }
    }
  }
  return null
}

/**
 * The proposals the user accepted only part of.
 *
 * Why the empty set is not one: nothing accepted is not a partial acceptance, it is no answer.
 */
export function partiallyAcceptedProposals(
  plan: RefactorPlan,
  acceptedHunkIds: Set<string>
): RefactorProposal[] {
  return plan.proposals.filter((proposal) => {
    const hunks = refactorHunksOfProposal(proposal)
    if (hunks.length === 0) {
      return false
    }
    const accepted = hunks.filter((hunk) => acceptedHunkIds.has(hunk.id)).length
    return accepted > 0 && accepted < hunks.length
  })
}
