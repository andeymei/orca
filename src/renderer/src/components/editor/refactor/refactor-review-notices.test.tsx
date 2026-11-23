// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ReviewJobState } from './refactor-review-job-status'
import { RefactorReviewNotices } from './refactor-review-notices'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string | number>) =>
    fallback.replace(/{{(\w+)}}/g, (_match, name) => String(values?.[name] ?? ''))
}))

afterEach(cleanup)

function renderNotices(job: ReviewJobState | null): HTMLElement {
  const { container } = render(
    <RefactorReviewNotices job={job} planUnavailable={false} failure={null} refusals={[]} />
  )
  return container
}

describe('the notices of the review tab', () => {
  it('shows the warnings of a job that succeeded', () => {
    // The spec asks for a marking that only a successful job can carry, so a job that succeeded
    // has to show its warnings too.
    renderNotices({
      state: 'done',
      progress: '',
      warnings: ['Proposal p1 was restored from the scratch directory; the agent gave no reason']
    })
    expect(
      screen.getByText(
        'Proposal p1 was restored from the scratch directory; the agent gave no reason'
      )
    ).toBeTruthy()
  })

  it('reads the warnings of a job that succeeded as information, not as a failure', () => {
    renderNotices({
      state: 'done',
      progress: '',
      warnings: ['The review shows at most 5 proposals; 1 could not be shown.']
    })
    expect(screen.queryByText('Refactoring failed')).toBeNull()
    expect(
      screen.getByText('The review shows at most 5 proposals; 1 could not be shown.').className
    ).not.toContain('text-destructive')
  })

  it('shows nothing when a job that succeeded has no warnings', () => {
    expect(renderNotices({ state: 'done', progress: '', warnings: [] }).innerHTML).toBe('')
  })

  it('shows the label and the warnings of a job that failed', () => {
    renderNotices({ state: 'failed', progress: '', warnings: ['Claude is not signed in'] })
    expect(screen.getByText('Refactoring failed')).toBeTruthy()
    expect(screen.getByText('Claude is not signed in')).toBeTruthy()
  })

  it('shows the label of a job that failed even when it carries no warning', () => {
    renderNotices({ state: 'timed_out', progress: '', warnings: [] })
    expect(
      screen.getByText('The refactoring timed out; starting it again is usually faster')
    ).toBeTruthy()
  })
})
