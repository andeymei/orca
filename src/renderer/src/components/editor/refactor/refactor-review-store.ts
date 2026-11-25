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
  /**
   * Notes what the job last said, and when it said it.
   *
   * Why the store keeps it: the review tab unmounts when the user looks at another tab, and a
   * clock that restarts on every visit reads as a job that never gets anywhere.
   */
  noteJobStep(jobId: string, step: string, at: number): void
  /** When the job was first seen running. */
  getJobStartedAt(jobId: string): number | null
  /** When the job last named a step. */
  getJobLastStepAt(jobId: string): number | null
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
  const jobSteps = new Map<string, { step: string; startedAt: number; lastStepAt: number }>()

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
   * Why one entry per job: the copy keeps a caller from changing the store without a notification.
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
    noteJobStep(jobId: string, step: string, at: number): void {
      const existing = jobSteps.get(jobId)
      if (!existing) {
        jobSteps.set(jobId, { step, startedAt: at, lastStepAt: at })
        notify(jobId)
        return
      }
      // Why the same step is not news: the job repeats the same line while it works, and a clock
      // that restarted on every repeat would never show the job going quiet.
      if (existing.step === step) {
        return
      }
      existing.step = step
      existing.lastStepAt = at
      notify(jobId)
    },
    getJobStartedAt(jobId: string): number | null {
      return jobSteps.get(jobId)?.startedAt ?? null
    },
    getJobLastStepAt(jobId: string): number | null {
      return jobSteps.get(jobId)?.lastStepAt ?? null
    },
    remove(jobId: string): void {
      plans.delete(jobId)
      selections.delete(jobId)
      jobSteps.delete(jobId)
      notify(jobId)
      // Why after the notice: a removed job is never read again, and the map would otherwise
      // hold one dead entry per job of the session.
      revisions.delete(jobId)
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
