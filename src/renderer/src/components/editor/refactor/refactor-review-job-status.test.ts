import { describe, expect, it } from 'vitest'

import { translate } from '@/i18n/i18n'

import { statusLabel, writtenLabel, type ReviewJobState } from './refactor-review-job-status'

import type { RefactorPlan } from '../../../../../shared/refactor/refactor-types'

const DONE_JOB: ReviewJobState = { state: 'done', progress: '', warnings: [] }

function planWith(proposalCount: number): RefactorPlan {
  return {
    jobId: 'job-1',
    sourcePath: 'src/foo.ts',
    proposals: Array.from({ length: proposalCount }, (_unused, index) => ({
      id: `p${index + 1}`,
      title: `proposal ${index + 1}`,
      rationale: 'r',
      files: []
    }))
  }
}

describe('the counts of the review tab', () => {
  it('reads one proposal in the singular', () => {
    expect(statusLabel(DONE_JOB, planWith(1), translate)).toBe('1 proposal generated')
  })

  it('reads several proposals in the plural', () => {
    expect(statusLabel(DONE_JOB, planWith(3), translate)).toBe('3 proposals generated')
  })

  it('reads one written file in the singular', () => {
    expect(writtenLabel(1, translate)).toBe('Wrote 1 file')
  })

  it('reads several written files in the plural', () => {
    expect(writtenLabel(2, translate)).toBe('Wrote 2 files')
  })
})
