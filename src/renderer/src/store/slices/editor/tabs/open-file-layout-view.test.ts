import { describe, expect, it } from 'vitest'
import { makeOpenFile } from '../types/open-file.test-fixture'
import { layoutEditorViewOfOpenFile, openFileOfLayoutEditorView } from './open-file-layout-view'

const REFACTOR_REVIEW = {
  jobId: 'job-1',
  worktreeId: 'wt-1',
  relativePath: 'src/foo.ts'
}

describe('the refactor review view', () => {
  it('names the job it reviews so another window can rebuild the tab', () => {
    const file = makeOpenFile({
      id: 'wt-1::refactor-review:job-1',
      worktreeId: 'wt-1',
      mode: 'refactor-review',
      refactorReview: REFACTOR_REVIEW
    })
    const layoutView = layoutEditorViewOfOpenFile(file)
    if (!layoutView) {
      throw new Error('expected a refactor review view')
    }
    expect(layoutView.view).toEqual({
      mode: 'refactor-review',
      refactorReview: REFACTOR_REVIEW
    })
    const rebuilt = openFileOfLayoutEditorView(layoutView, {
      entityId: file.id,
      worktreeId: file.worktreeId
    })
    expect(rebuilt.mode).toBe('refactor-review')
    expect(rebuilt.refactorReview).toEqual(REFACTOR_REVIEW)
  })
})
