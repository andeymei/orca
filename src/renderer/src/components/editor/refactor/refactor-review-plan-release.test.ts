import { beforeEach, describe, expect, it } from 'vitest'

import { createEditorTabsStore } from '@/store/slices/editor/editor-slice-test-harness'
import { makeOpenFile } from '@/store/slices/editor/types/open-file.test-fixture'

import { installRefactorReviewPlanRelease } from './refactor-review-plan-release'
import { refactorReviewStore } from './refactor-review-store'

import type { RefactorPlan } from '../../../../../shared/refactor/refactor-types'

const PLAN: RefactorPlan = {
  jobId: 'job-1',
  sourcePath: 'src/foo.ts',
  proposals: [
    {
      id: 'p1',
      title: 't',
      rationale: 'r',
      files: [
        {
          path: 'src/foo.ts',
          originalContent: 'a\n',
          hunks: [
            {
              id: 'src/foo.ts:h1',
              originalStartLine: 1,
              originalLineCount: 1,
              modifiedStartLine: 1,
              modifiedLineCount: 1,
              originalText: 'a\n',
              modifiedText: 'b\n'
            }
          ]
        }
      ]
    }
  ]
}

const reviewFile = makeOpenFile({
  id: 'wt-1::refactor-review:job-1',
  worktreeId: 'wt-1',
  mode: 'refactor-review',
  refactorReview: { jobId: 'job-1', worktreeId: 'wt-1', relativePath: 'src/foo.ts' }
})

const otherFile = makeOpenFile({ id: 'file-1', worktreeId: 'wt-1' })

beforeEach(() => {
  refactorReviewStore.remove('job-1')
})

describe('the plan of a closed review tab', () => {
  it('is dropped when the review tab closed while another tab was active', () => {
    const store = createEditorTabsStore()
    installRefactorReviewPlanRelease(store)
    refactorReviewStore.setPlan('job-1', PLAN)
    store.setState({ openFiles: [otherFile, reviewFile], activeFileId: otherFile.id })
    store.getState().closeFile(reviewFile.id)
    expect(refactorReviewStore.getPlan('job-1')).toBeNull()
  })

  it('survives while the review tab is still open', () => {
    const store = createEditorTabsStore()
    installRefactorReviewPlanRelease(store)
    refactorReviewStore.setPlan('job-1', PLAN)
    store.setState({ openFiles: [reviewFile, otherFile], activeFileId: reviewFile.id })
    store.getState().closeFile(otherFile.id)
    expect(refactorReviewStore.getPlan('job-1')).not.toBeNull()
  })
})
