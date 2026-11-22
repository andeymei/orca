// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileContent } from '../editor-panel-content-types'
import { RefactorTriggerButton, refactorSourceContent } from './refactor-trigger-button'

const mocks = vi.hoisted(() => ({
  openRefactorReviewTab:
    vi.fn<(input: { worktreeId: string; relativePath: string; content: string }) => Promise<void>>()
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string | number>) =>
    fallback.replace(/{{(\w+)}}/g, (_match, name) => String(values?.[name] ?? ''))
}))

vi.mock('./refactor-review-tab-open', () => ({
  openRefactorReviewTab: mocks.openRefactorReviewTab
}))

function loaded(overrides: Partial<FileContent> = {}): FileContent {
  return {
    content: 'const a = 1\n',
    isBinary: false,
    ...overrides
  }
}

function renderTrigger(drafts: Record<string, string> = {}): void {
  render(
    <RefactorTriggerButton
      fileId="file-1"
      worktreeId="wt-1"
      relativePath="src/foo.ts"
      drafts={drafts}
      fileContents={{ 'file-1': loaded() }}
    />
  )
}

beforeEach(() => {
  mocks.openRefactorReviewTab.mockReset()
  mocks.openRefactorReviewTab.mockResolvedValue(undefined)
})

afterEach(cleanup)

describe('the text a refactoring runs on', () => {
  it('takes the unsaved buffer, so the agent sees what the user sees', () => {
    expect(refactorSourceContent('const a = 2\n', loaded())).toBe('const a = 2\n')
  })

  it('falls back to the file on disk when nothing is unsaved', () => {
    expect(refactorSourceContent(undefined, loaded())).toBe('const a = 1\n')
  })

  it('refuses a binary file', () => {
    expect(refactorSourceContent(undefined, loaded({ isBinary: true }))).toBe('')
  })

  it('refuses a file that could not be read', () => {
    expect(refactorSourceContent(undefined, loaded({ loadError: 'gone' }))).toBe('')
  })

  it('refuses a file whose cached content is outdated', () => {
    expect(refactorSourceContent(undefined, loaded({ isStale: true }))).toBe('')
  })

  it('refuses a file that was never read', () => {
    expect(refactorSourceContent(undefined, undefined)).toBe('')
  })
})

describe('the refactoring trigger', () => {
  it('starts a refactoring of the file the user is looking at', async () => {
    renderTrigger()
    fireEvent.click(screen.getByRole('button', { name: 'Refactor' }))
    await waitFor(() =>
      expect(mocks.openRefactorReviewTab).toHaveBeenCalledWith({
        worktreeId: 'wt-1',
        relativePath: 'src/foo.ts',
        content: 'const a = 1\n'
      })
    )
  })

  it('runs the refactoring on the unsaved buffer', async () => {
    renderTrigger({ 'file-1': 'const a = 2\n' })
    fireEvent.click(screen.getByRole('button', { name: 'Refactor' }))
    await waitFor(() =>
      expect(mocks.openRefactorReviewTab).toHaveBeenCalledWith({
        worktreeId: 'wt-1',
        relativePath: 'src/foo.ts',
        content: 'const a = 2\n'
      })
    )
  })

  it('starts no second refactoring while the first is still starting', async () => {
    let finish: () => void = () => {}
    mocks.openRefactorReviewTab.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    renderTrigger()
    const button = screen.getByRole('button', { name: 'Refactor' })
    fireEvent.click(button)
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(true))
    fireEvent.click(button)
    expect(mocks.openRefactorReviewTab).toHaveBeenCalledTimes(1)
    finish()
  })

  it('cannot start a refactoring of a file it cannot read', () => {
    render(
      <RefactorTriggerButton
        fileId="file-1"
        worktreeId="wt-1"
        relativePath="src/foo.ts"
        drafts={{}}
        fileContents={{}}
      />
    )
    const button = screen.getByRole('button', { name: 'Refactor' })
    expect(button.hasAttribute('disabled')).toBe(true)
  })
})
