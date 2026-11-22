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
      warnings: ['方案 p1 是从暂存目录还原的，agent 未给出理由']
    })
    expect(screen.getByText('方案 p1 是从暂存目录还原的，agent 未给出理由')).toBeTruthy()
  })

  it('reads the warnings of a job that succeeded as information, not as a failure', () => {
    renderNotices({
      state: 'done',
      progress: '',
      warnings: ['有 1 个方案超出方案数量上限，已丢弃']
    })
    expect(screen.queryByText('Refactoring failed')).toBeNull()
    expect(screen.getByText('有 1 个方案超出方案数量上限，已丢弃').className).not.toContain(
      'text-destructive'
    )
  })

  it('shows nothing when a job that succeeded has no warnings', () => {
    expect(renderNotices({ state: 'done', progress: '', warnings: [] }).innerHTML).toBe('')
  })

  it('shows the label and the warnings of a job that failed', () => {
    renderNotices({ state: 'failed', progress: '', warnings: ['Claude 未登录'] })
    expect(screen.getByText('Refactoring failed')).toBeTruthy()
    expect(screen.getByText('Claude 未登录')).toBeTruthy()
  })

  it('shows the label of a job that failed even when it carries no warning', () => {
    renderNotices({ state: 'timed_out', progress: '', warnings: [] })
    expect(
      screen.getByText('The refactoring timed out; starting it again is usually faster')
    ).toBeTruthy()
  })
})
