// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RefactorHunk, RefactorPlan } from '../../../../../shared/refactor/refactor-types'
import { refactorReviewStore } from './refactor-review-store'
import { RefactorReviewTab } from './refactor-review-tab'
import { openRefactorReviewTab } from './refactor-review-tab-open'

type JobStatus = {
  state: 'running' | 'done' | 'failed' | 'timed_out' | 'cancelled'
  progress: string
  warnings: string[]
}

type ApplyResult = {
  applied: { path: string; hunksApplied: number }[]
  refusals: { path: string; reason: string }[]
}

const mocks = vi.hoisted(() => {
  const openFiles: { id: string; refactorReview?: { jobId: string } }[] = []
  return {
    state: {
      openFiles,
      closeFile: vi.fn(),
      openFile: vi.fn(),
      settings: { diffDefaultView: 'side-by-side' },
      getKnownWorktreeById: vi.fn(() => ({ path: '/repo' }))
    },
    applyRefactor: vi.fn<(jobId: string, hunkIds: readonly string[]) => Promise<ApplyResult>>(),
    discardRefactor: vi.fn<(jobId: string) => Promise<boolean>>(),
    fetchRefactorStatus: vi.fn<(jobId: string) => Promise<JobStatus>>(),
    fetchRefactorPlan: vi.fn<(jobId: string) => Promise<RefactorPlan | null>>(),
    proposeRefactor:
      vi.fn<
        (input: {
          worktreeId: string
          relativePath: string
          content: string
        }) => Promise<
          { jobId: string } | { failure: 'refused'; reason: string } | { failure: 'unreachable' }
        >
      >(),
    toastError: vi.fn(),
    toastSuccess: vi.fn()
  }
})

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string | number>) =>
    fallback.replace(/{{(\w+)}}/g, (_match, name) => String(values?.[name] ?? ''))
}))

vi.mock('@/store/index', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
    { getState: () => mocks.state }
  )
}))

vi.mock('./refactor-runtime-client', () => ({
  applyRefactor: mocks.applyRefactor,
  discardRefactor: mocks.discardRefactor,
  fetchRefactorStatus: mocks.fetchRefactorStatus,
  fetchRefactorPlan: mocks.fetchRefactorPlan,
  proposeRefactor: mocks.proposeRefactor
}))

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: mocks.toastError,
    success: mocks.toastSuccess
  })
}))

vi.mock('../editor-lazy-views', () => ({
  DiffViewer: (props: {
    originalContent: string
    modifiedContent: string
    filePath: string
    relativePath: string
  }) => (
    <div
      data-testid="diff-viewer"
      data-file-path={props.filePath}
      data-relative-path={props.relativePath}
    >
      {props.originalContent}|{props.modifiedContent}
    </div>
  )
}))

function hunk(id: string, line: number, original: string, modified: string): RefactorHunk {
  return {
    id,
    originalStartLine: line,
    originalLineCount: 1,
    modifiedStartLine: line,
    modifiedLineCount: 1,
    originalText: original,
    modifiedText: modified
  }
}

const ORIGINAL = 'const a = 1\nconst b = 2\nconst c = 3\n'

const PLAN: RefactorPlan = {
  jobId: 'job-1',
  sourcePath: 'src/foo.ts',
  proposals: [
    {
      id: 'p1',
      title: '提取参数校验',
      rationale: '两处校验规则相同',
      files: [
        {
          path: 'src/foo.ts',
          originalContent: ORIGINAL,
          hunks: [
            hunk('src/foo.ts:h1', 1, 'const a = 1\n', 'const a = assertPositive(1)\n'),
            hunk('src/foo.ts:h2', 3, 'const c = 3\n', 'const c = assertPositive(3)\n')
          ]
        }
      ]
    }
  ]
}

function renderTab(): ReturnType<typeof render> {
  return render(<RefactorReviewTab jobId="job-1" worktreeId="wt-1" relativePath="src/foo.ts" />)
}

beforeEach(() => {
  refactorReviewStore.remove('job-1')
  refactorReviewStore.setPlan('job-1', PLAN)
  mocks.state.openFiles = []
  mocks.state.closeFile.mockClear()
  mocks.state.openFile.mockClear()
  mocks.toastError.mockClear()
  mocks.toastSuccess.mockClear()
  mocks.fetchRefactorStatus.mockResolvedValue({ state: 'done', progress: '', warnings: [] })
  mocks.fetchRefactorPlan.mockResolvedValue(null)
  mocks.applyRefactor.mockResolvedValue({
    applied: [{ path: 'src/foo.ts', hunksApplied: 1 }],
    refusals: []
  })
  mocks.discardRefactor.mockResolvedValue(true)
  mocks.proposeRefactor.mockResolvedValue({ jobId: 'job-1' })
})

afterEach(cleanup)

describe('the refactor review tab', () => {
  it('shows the proposal title and its rationale', () => {
    renderTab()
    expect(screen.getByText('提取参数校验')).toBeTruthy()
    expect(screen.getByText(/两处校验规则相同/)).toBeTruthy()
  })

  it('warns when only part of a proposal is accepted', () => {
    renderTab()
    fireEvent.click(screen.getByRole('checkbox', { name: '接受 src/foo.ts 的代码块 1' }))
    expect(screen.getByText(/只接受其中一处可能无法编译/)).toBeTruthy()
  })

  it('shows the change of the selected hunk on the right', () => {
    renderTab()
    expect(screen.getByTestId('diff-viewer').textContent).toBe(
      'const a = 1\n|const a = assertPositive(1)\n'
    )
  })

  it('shows the whole file of the proposal when the view is switched', () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '查看完整文件' }))
    expect(screen.getByTestId('diff-viewer').textContent).toBe(
      `${ORIGINAL}|const a = assertPositive(1)\nconst b = 2\nconst c = assertPositive(3)\n`
    )
  })

  it('gives the viewer the absolute path of the file, not the relative one', () => {
    renderTab()
    const viewer = screen.getByTestId('diff-viewer')
    expect(viewer.getAttribute('data-file-path')).toBe('/repo/src/foo.ts')
    expect(viewer.getAttribute('data-relative-path')).toBe('src/foo.ts')
  })

  it('accepts the whole proposal when the warning asks for it', () => {
    renderTab()
    fireEvent.click(screen.getByRole('checkbox', { name: '接受 src/foo.ts 的代码块 1' }))
    fireEvent.click(screen.getByRole('button', { name: '接受该方案全部改动' }))
    const accepted = refactorReviewStore.getSelection('job-1').acceptedHunkIds
    expect(accepted.has('src/foo.ts:h1')).toBe(true)
    expect(accepted.has('src/foo.ts:h2')).toBe(true)
  })

  it('writes the accepted hunks and closes the tab', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('checkbox', { name: '接受 src/foo.ts 的代码块 1' }))
    fireEvent.click(screen.getByRole('button', { name: '应用已接受' }))
    await waitFor(() =>
      expect(mocks.applyRefactor).toHaveBeenCalledWith('job-1', ['src/foo.ts:h1'])
    )
    await waitFor(() =>
      expect(mocks.state.closeFile).toHaveBeenCalledWith('wt-1::refactor-review:job-1')
    )
  })

  it('keeps the tab open and says why when the write is refused', async () => {
    mocks.applyRefactor.mockResolvedValue({
      applied: [],
      refusals: [{ path: 'src/foo.ts', reason: '文件在评审期间被改动过，请重新生成重构建议' }]
    })
    renderTab()
    fireEvent.click(screen.getByRole('checkbox', { name: '接受 src/foo.ts 的代码块 1' }))
    fireEvent.click(screen.getByRole('button', { name: '应用已接受' }))
    await waitFor(() =>
      expect(screen.getByText('文件在评审期间被改动过，请重新生成重构建议')).toBeTruthy()
    )
    expect(mocks.state.closeFile).not.toHaveBeenCalled()
  })

  it('shows the reason of a failed job in the tab', async () => {
    mocks.fetchRefactorStatus.mockResolvedValue({
      state: 'failed',
      progress: '',
      warnings: ['Claude 未登录']
    })
    renderTab()
    expect(await screen.findByText('Claude 未登录')).toBeTruthy()
  })

  it('tells a timeout apart from a failure, because a retry is faster', async () => {
    mocks.fetchRefactorStatus.mockResolvedValue({ state: 'timed_out', progress: '', warnings: [] })
    renderTab()
    expect(await screen.findByText(/超时/)).toBeTruthy()
  })

  it('keeps the plan when the user only looked away', () => {
    const view = renderTab()
    mocks.state.openFiles = [
      { id: 'wt-1::refactor-review:job-1', refactorReview: { jobId: 'job-1' } }
    ]
    view.unmount()
    expect(refactorReviewStore.getPlan('job-1')).not.toBeNull()
  })

  it('drops the plan when the tab was closed', () => {
    const view = renderTab()
    mocks.state.openFiles = []
    view.unmount()
    expect(refactorReviewStore.getPlan('job-1')).toBeNull()
  })
})

describe('starting a refactoring review', () => {
  it('opens a tab that names the job', async () => {
    await openRefactorReviewTab({
      worktreeId: 'wt-1',
      relativePath: 'src/foo.ts',
      content: 'const a = 1'
    })
    expect(mocks.state.openFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: 'wt-1::refactor-review:job-1',
        worktreeId: 'wt-1',
        mode: 'refactor-review',
        refactorReview: { jobId: 'job-1', worktreeId: 'wt-1', relativePath: 'src/foo.ts' }
      }),
      expect.objectContaining({ reopenId: 'wt-1::refactor-review:job-1' })
    )
  })

  it('opens no tab when the request was refused, and says why', async () => {
    mocks.proposeRefactor.mockResolvedValue({
      failure: 'refused',
      reason: '远程主机上的重构暂不支持'
    })
    await openRefactorReviewTab({
      worktreeId: 'wt-1',
      relativePath: 'src/foo.ts',
      content: 'const a = 1'
    })
    expect(mocks.state.openFile).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('远程主机上的重构暂不支持')
  })
})
