import type { AppState } from '@/store/types'

import { refactorReviewStore } from './refactor-review-store'

type ReviewPlanReleaseHost = {
  subscribe: (listener: (state: AppState, previous: AppState) => void) => () => void
}

/**
 * Drops the plan of a review job whose tab closed.
 *
 * Why an observer and not the review tab's unmount: the editor panel mounts one file at a time, so
 * a review tab that is not the active one has no component to unmount — and its plan, which holds
 * every touched file's full text, would stay for the rest of the session.
 */
export function installRefactorReviewPlanRelease(store: ReviewPlanReleaseHost): void {
  store.subscribe((state, previous) => {
    if (state.openFiles === previous.openFiles) {
      return
    }
    const openFileIds = new Set(state.openFiles.map((file) => file.id))
    for (const file of previous.openFiles) {
      if (openFileIds.has(file.id)) {
        continue
      }
      const jobId = file.refactorReview?.jobId
      if (jobId) {
        refactorReviewStore.remove(jobId)
      }
    }
  })
}
