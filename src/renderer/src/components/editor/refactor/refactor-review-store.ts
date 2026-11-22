import type {
  RefactorHunk,
  RefactorPlan,
  RefactorProposal
} from '../../../../../shared/refactor/refactor-types'

/**
 * What the user accepted so far, and what the right pane is looking at.
 *
 * Why the accepted set is flat: a hunk id names the file it belongs to, so one set holds the hunks
 * of every level of the tree.
 */
export type RefactorReviewSelection = {
  /** The hunks the user accepted. The ids are opaque strings; compare them whole. */
  acceptedHunkIds: Set<string>
  /** The hunk the right pane shows. */
  selectedHunkId: string | null
  /** The file the right pane shows. */
  selectedFilePath: string | null
}

export type RefactorReviewStore = {
  /** Keeps the plan the agent produced for the job. */
  setPlan(jobId: string, plan: RefactorPlan): void
  getPlan(jobId: string): RefactorPlan | null
  /** Replaces the whole selection: what is accepted and what the right pane shows. */
  setSelection(jobId: string, selection: RefactorReviewSelection): void
  /** A copy of the selection: a caller cannot change the store through what it was handed. */
  getSelection(jobId: string): RefactorReviewSelection
  /** Accepts one hunk, or gives it back when it was already accepted. */
  toggleHunk(jobId: string, hunkId: string): void
  /** Accepts or gives back a set of hunks at once, which is what a file or proposal node does. */
  setHunkSelection(jobId: string, hunkIds: readonly string[], accepted: boolean): void
  /** Drops the plan and the selection of the job. */
  remove(jobId: string): void
  /** Tells the tab that shows the job that its plan or selection changed. */
  subscribe(jobId: string, listener: () => void): () => void
  /**
   * How often the job changed.
   *
   * Why it exists: the selection is handed out as a copy, and a fresh copy cannot be the snapshot
   * of `useSyncExternalStore`. A tree watches the revision and reads the selection again when it
   * moves.
   */
  getRevision(jobId: string): number
}

/** The selection a job that was never reviewed has. */
function emptySelection(): RefactorReviewSelection {
  return {
    acceptedHunkIds: new Set<string>(),
    selectedHunkId: null,
    selectedFilePath: null
  }
}

/** A selection the caller cannot change the store through. */
function copyOf(selection: RefactorReviewSelection): RefactorReviewSelection {
  return {
    acceptedHunkIds: new Set(selection.acceptedHunkIds),
    selectedHunkId: selection.selectedHunkId,
    selectedFilePath: selection.selectedFilePath
  }
}

export function createRefactorReviewStore(): RefactorReviewStore {
  const plans = new Map<string, RefactorPlan>()
  const selections = new Map<string, RefactorReviewSelection>()
  const revisions = new Map<string, number>()
  const listeners = new Map<string, Set<() => void>>()

  const notify = (jobId: string): void => {
    revisions.set(jobId, (revisions.get(jobId) ?? 0) + 1)
    const jobListeners = listeners.get(jobId)
    if (!jobListeners) {
      return
    }
    for (const listener of jobListeners) {
      listener()
    }
  }

  /**
   * The selection of the job, created empty when the job was never reviewed.
   *
   * Why one entry per job: the accepted set is handed out, so a shared empty set would let one
   * job's hunks leak into another's.
   */
  const selectionOf = (jobId: string): RefactorReviewSelection => {
    const existing = selections.get(jobId)
    if (existing) {
      return existing
    }
    const empty = emptySelection()
    selections.set(jobId, empty)
    return empty
  }

  const storeSelection = (jobId: string, selection: RefactorReviewSelection): void => {
    selections.set(jobId, selection)
    notify(jobId)
  }

  const withAcceptedHunkIds = (
    current: RefactorReviewSelection,
    acceptedHunkIds: Set<string>
  ): RefactorReviewSelection => ({
    acceptedHunkIds,
    // Why: ticking a checkbox must not move the code block the user is reading.
    selectedHunkId: current.selectedHunkId,
    selectedFilePath: current.selectedFilePath
  })

  return {
    setPlan(jobId: string, plan: RefactorPlan): void {
      plans.set(jobId, plan)
      // Why: a hunk id of the old plan can name a different hunk of the new one, so the accepted
      // set of the old plan cannot survive it.
      selections.delete(jobId)
      notify(jobId)
    },
    getPlan(jobId: string): RefactorPlan | null {
      return plans.get(jobId) ?? null
    },
    setSelection(jobId: string, selection: RefactorReviewSelection): void {
      storeSelection(jobId, copyOf(selection))
    },
    getSelection(jobId: string): RefactorReviewSelection {
      return copyOf(selectionOf(jobId))
    },
    toggleHunk(jobId: string, hunkId: string): void {
      // Why: without a plan there is nothing to accept, so the tick is ignored.
      if (!plans.has(jobId)) {
        return
      }
      const current = selectionOf(jobId)
      const acceptedHunkIds = new Set(current.acceptedHunkIds)
      if (acceptedHunkIds.has(hunkId)) {
        acceptedHunkIds.delete(hunkId)
      } else {
        acceptedHunkIds.add(hunkId)
      }
      storeSelection(jobId, withAcceptedHunkIds(current, acceptedHunkIds))
    },
    setHunkSelection(jobId: string, hunkIds: readonly string[], accepted: boolean): void {
      if (!plans.has(jobId)) {
        return
      }
      const current = selectionOf(jobId)
      const acceptedHunkIds = new Set(current.acceptedHunkIds)
      for (const hunkId of hunkIds) {
        if (accepted) {
          acceptedHunkIds.add(hunkId)
        } else {
          acceptedHunkIds.delete(hunkId)
        }
      }
      storeSelection(jobId, withAcceptedHunkIds(current, acceptedHunkIds))
    },
    remove(jobId: string): void {
      plans.delete(jobId)
      selections.delete(jobId)
      notify(jobId)
    },
    subscribe(jobId: string, listener: () => void): () => void {
      const jobListeners = listeners.get(jobId) ?? new Set<() => void>()
      jobListeners.add(listener)
      listeners.set(jobId, jobListeners)
      return () => {
        jobListeners.delete(listener)
        if (jobListeners.size === 0) {
          listeners.delete(jobId)
        }
      }
    },
    getRevision(jobId: string): number {
      return revisions.get(jobId) ?? 0
    }
  }
}

/** Every hunk the proposal makes, across the files it touches. */
export function refactorHunksOfProposal(proposal: RefactorProposal): RefactorHunk[] {
  return proposal.files.flatMap((file) => file.hunks)
}

/** The hunks the proposal makes in one file. */
export function refactorHunksOfFile(proposal: RefactorProposal, path: string): RefactorHunk[] {
  const file = proposal.files.find((candidate) => candidate.path === path)
  return file?.hunks ?? []
}

/** The store the review tab and the proposal tree share, so both see the same selection. */
export const refactorReviewStore: RefactorReviewStore = createRefactorReviewStore()
