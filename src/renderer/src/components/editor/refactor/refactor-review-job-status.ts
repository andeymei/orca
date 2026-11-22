import type { Translate } from '@/i18n/use-translate'

import type { RefactorPlan } from '../../../../../shared/refactor/refactor-types'

/** How far the job has come, in the words the runtime uses. */
export type ReviewJobState = {
  state: 'running' | 'done' | 'failed' | 'timed_out' | 'cancelled'
  progress: string
  warnings: string[]
}

/** The job states that ended without a plan to review. */
export type UnfinishedJobState = ReviewJobState & { state: 'failed' | 'timed_out' | 'cancelled' }

/** What the header says about the job, without claiming more than happened. */
export function statusLabel(
  job: ReviewJobState | null,
  plan: RefactorPlan | null,
  t: Translate
): string | null {
  if (!job) {
    return t('auto.components.editor.RefactorReviewTab.starting', 'Starting')
  }
  switch (job.state) {
    case 'running':
      return t('auto.components.editor.RefactorReviewTab.generating', 'Generating')
    case 'done':
      return plan
        ? t('auto.components.editor.RefactorReviewTab.generated', '{{count}} proposals generated', {
            count: plan.proposals.length
          })
        : t('auto.components.editor.RefactorReviewTab.loadingProposals', 'Loading the proposals')
    default:
      // Why: a job that ended badly says so in the notice below, not twice.
      return null
  }
}

/** What the notice says about a job that ended without proposals. */
export function failureLabel(job: UnfinishedJobState, t: Translate): string {
  switch (job.state) {
    case 'failed':
      return t('auto.components.editor.RefactorReviewTab.failed', 'Refactoring failed')
    case 'timed_out':
      return t(
        'auto.components.editor.RefactorReviewTab.timedOut',
        'The refactoring timed out; starting it again is usually faster'
      )
    case 'cancelled':
      return t('auto.components.editor.RefactorReviewTab.cancelled', 'Refactoring cancelled')
  }
}

/** The job, when it ended without proposals. */
export function unfinishedJob(job: ReviewJobState | null): UnfinishedJobState | null {
  if (!job || job.state === 'running' || job.state === 'done') {
    return null
  }
  return { ...job, state: job.state }
}
