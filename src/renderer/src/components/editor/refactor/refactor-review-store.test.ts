import { describe, expect, it } from 'vitest'
import type { RefactorHunk, RefactorPlan } from '../../../../../shared/refactor/refactor-types'
import {
  createRefactorReviewStore,
  refactorHunksOfFile,
  refactorHunksOfProposal
} from './refactor-review-store'

const plan = {
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
              id: 'h1',
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

function hunk(id: string): RefactorHunk {
  return {
    id,
    originalStartLine: 1,
    originalLineCount: 1,
    modifiedStartLine: 1,
    modifiedLineCount: 1,
    originalText: 'a\n',
    modifiedText: 'b\n'
  }
}

/** Two files in one proposal: their hunks carry different ids because the id names the file. */
const twoFilePlan: RefactorPlan = {
  jobId: 'job-2',
  sourcePath: 'src/foo.ts',
  proposals: [
    {
      id: 'p1',
      title: 't',
      rationale: 'r',
      files: [
        { path: 'src/foo.ts', originalContent: 'a\n', hunks: [hunk('src/foo.ts:h1')] },
        { path: 'src/bar.ts', originalContent: 'b\n', hunks: [hunk('src/bar.ts:h1')] }
      ]
    }
  ]
}

describe('the refactor review store', () => {
  it('starts with nothing accepted', () => {
    const store = createRefactorReviewStore()
    store.setPlan('job-1', plan)
    expect(store.getSelection('job-1').acceptedHunkIds.size).toBe(0)
  })

  it('toggles one hunk', () => {
    const store = createRefactorReviewStore()
    store.setPlan('job-1', plan)
    store.toggleHunk('job-1', 'h1')
    expect(store.getSelection('job-1').acceptedHunkIds.has('h1')).toBe(true)
    store.toggleHunk('job-1', 'h1')
    expect(store.getSelection('job-1').acceptedHunkIds.has('h1')).toBe(false)
  })

  it('accepts every hunk of a file at once', () => {
    const store = createRefactorReviewStore()
    store.setPlan('job-1', plan)
    store.setHunkSelection('job-1', ['h1'], true)
    expect(store.getSelection('job-1').acceptedHunkIds.has('h1')).toBe(true)
  })

  it('drops the selection with the plan', () => {
    const store = createRefactorReviewStore()
    store.setPlan('job-1', plan)
    store.remove('job-1')
    expect(store.getPlan('job-1')).toBeNull()
  })

  it('gives back every hunk of a file when the file is unticked', () => {
    const store = createRefactorReviewStore()
    store.setPlan('job-1', plan)
    store.setHunkSelection('job-1', ['h1'], true)
    store.setHunkSelection('job-1', ['h1'], false)
    expect(store.getSelection('job-1').acceptedHunkIds.has('h1')).toBe(false)
  })

  it('keeps the hunk the user is reading when a checkbox is ticked', () => {
    const store = createRefactorReviewStore()
    store.setPlan('job-1', plan)
    store.setSelection('job-1', {
      acceptedHunkIds: new Set(),
      selectedHunkId: 'h1',
      selectedFilePath: 'src/foo.ts'
    })
    store.toggleHunk('job-1', 'h1')
    const selection = store.getSelection('job-1')
    expect(selection.selectedHunkId).toBe('h1')
    expect(selection.selectedFilePath).toBe('src/foo.ts')
  })

  it('ignores a tick for a job that has no plan', () => {
    const store = createRefactorReviewStore()
    store.toggleHunk('job-1', 'h1')
    store.setHunkSelection('job-1', ['h1'], true)
    expect(store.getSelection('job-1').acceptedHunkIds.size).toBe(0)
  })

  it('flattens the hunks of a proposal across its files', () => {
    const proposal = twoFilePlan.proposals[0]
    expect(refactorHunksOfProposal(proposal).map((entry) => entry.id)).toEqual([
      'src/foo.ts:h1',
      'src/bar.ts:h1'
    ])
  })

  it('keeps the hunks of one file of a proposal', () => {
    const proposal = twoFilePlan.proposals[0]
    expect(refactorHunksOfFile(proposal, 'src/bar.ts').map((entry) => entry.id)).toEqual([
      'src/bar.ts:h1'
    ])
    expect(refactorHunksOfFile(proposal, 'src/other.ts')).toEqual([])
  })
})
