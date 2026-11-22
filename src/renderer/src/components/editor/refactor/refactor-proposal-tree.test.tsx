// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RefactorHunk, RefactorPlan } from '../../../../../shared/refactor/refactor-types'
import { refactorReviewStore } from './refactor-review-store'
import { RefactorProposalTree } from './refactor-proposal-tree'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string>) =>
    fallback.replace(/{{(\w+)}}/g, (_match, name) => values?.[name] ?? '')
}))

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

const plan: RefactorPlan = {
  jobId: 'job-1',
  sourcePath: 'src/foo.ts',
  proposals: [
    {
      id: 'p1',
      title: '提取参数校验',
      rationale: '',
      files: [
        { path: 'src/foo.ts', originalContent: 'a\n', hunks: [hunk('src/foo.ts:h1')] },
        { path: 'src/bar.ts', originalContent: 'b\n', hunks: [hunk('src/bar.ts:h1')] }
      ]
    }
  ]
}

beforeEach(() => {
  refactorReviewStore.remove('job-1')
  refactorReviewStore.setPlan('job-1', plan)
})

afterEach(cleanup)

describe('the refactor proposal tree', () => {
  it('shows the proposal and says when the agent gave no reason', () => {
    render(<RefactorProposalTree jobId="job-1" />)
    expect(screen.getByText('提取参数校验')).toBeTruthy()
    expect(screen.getByText('未给出理由')).toBeTruthy()
  })

  it('accepts every hunk of the proposal when the proposal is ticked', () => {
    render(<RefactorProposalTree jobId="job-1" />)
    fireEvent.click(screen.getByRole('checkbox', { name: '接受方案 提取参数校验' }))
    const accepted = refactorReviewStore.getSelection('job-1').acceptedHunkIds
    expect(accepted.has('src/foo.ts:h1')).toBe(true)
    expect(accepted.has('src/bar.ts:h1')).toBe(true)
  })

  it('accepts only the hunks of one file when the file is ticked', () => {
    render(<RefactorProposalTree jobId="job-1" />)
    fireEvent.click(screen.getByRole('checkbox', { name: '接受文件 src/bar.ts' }))
    const accepted = refactorReviewStore.getSelection('job-1').acceptedHunkIds
    expect(accepted.has('src/bar.ts:h1')).toBe(true)
    expect(accepted.has('src/foo.ts:h1')).toBe(false)
  })

  it('accepts one hunk when the hunk is ticked', () => {
    render(<RefactorProposalTree jobId="job-1" />)
    fireEvent.click(screen.getByRole('checkbox', { name: '接受 src/foo.ts 的代码块 1' }))
    const accepted = refactorReviewStore.getSelection('job-1').acceptedHunkIds
    expect(accepted.has('src/foo.ts:h1')).toBe(true)
    expect(accepted.has('src/bar.ts:h1')).toBe(false)
  })

  it('points the right pane at the hunk the user picked', () => {
    render(<RefactorProposalTree jobId="job-1" />)
    fireEvent.click(screen.getAllByText('代码块 1')[0])
    const selection = refactorReviewStore.getSelection('job-1')
    expect(selection.selectedHunkId).toBe('src/foo.ts:h1')
    expect(selection.selectedFilePath).toBe('src/foo.ts')
  })
})
