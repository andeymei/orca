// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { OpenFile } from '@/store/slices/editor/types/open-file'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: { reloadOpenCheckRunDetailsTab: () => void }) => unknown) =>
    selector({ reloadOpenCheckRunDetailsTab: () => {} })
}))

vi.mock('./git-graph/git-graph-tab', () => ({ GitGraphTab: () => null }))
vi.mock('./check-details/panel/CheckRunDetailsPanel', () => ({ CheckRunDetailsPanel: () => null }))
vi.mock('./editor-lazy-views', () => ({
  CombinedDiffViewer: () => null,
  MarkdownPreview: () => null
}))
vi.mock('./EditorConflictReviewSurface', () => ({ EditorConflictReviewSurface: () => null }))
vi.mock('./EditorDiffFileSurface', () => ({ EditorDiffFileSurface: () => null }))
vi.mock('./EditorEditFileSurface', () => ({ EditorEditFileSurface: () => null }))
vi.mock('./EditorFileLoadErrorView', () => ({ EditorFileLoadErrorView: () => null }))
vi.mock('./markdown-preview/render-tree/MarkdownPreviewSizeGate', () => ({
  MarkdownPreviewSizeGate: ({ children }: { children: React.ReactNode }) => children
}))
vi.mock('./markdown/documents/useMarkdownDocuments', () => ({
  useMarkdownDocuments: () => ({ previewProps: {} })
}))
vi.mock('./useEditorConflictNavigation', () => ({ useEditorConflictNavigation: () => null }))
vi.mock('./refactor/refactor-review-tab', () => ({
  RefactorReviewTab: (props: { jobId: string; worktreeId: string; relativePath: string }) => (
    <div
      data-testid="refactor-review-tab"
      data-job-id={props.jobId}
      data-worktree-id={props.worktreeId}
      data-relative-path={props.relativePath}
    />
  )
}))

import { EditorContent } from './EditorContent'

const reviewFile: OpenFile = {
  id: 'wt-1::refactor-review:job-1',
  filePath: 'wt-1::refactor-review:job-1',
  relativePath: 'src/foo.ts',
  worktreeId: 'wt-1',
  language: 'plaintext',
  isDirty: false,
  mode: 'refactor-review',
  refactorReview: { jobId: 'job-1', worktreeId: 'wt-1', relativePath: 'src/foo.ts' }
}

function renderContent(activeFile: OpenFile): void {
  render(
    <EditorContent
      activeFile={activeFile}
      viewStateScopeId={activeFile.id}
      fileContents={{}}
      diffContents={{}}
      editBuffers={{}}
      openFiles={[activeFile]}
      worktreeEntries={[]}
      resolvedLanguage="plaintext"
      isMarkdown={false}
      isMermaid={false}
      isCsv={false}
      isNotebook={false}
      mdViewMode="source"
      inlineMarkdownRenderState={null}
      isChangesMode={false}
      sideBySide={false}
      pendingEditorReveal={null}
      handleContentChange={() => {}}
      handleContentChangeForFile={() => {}}
      handleDirtyStateHint={() => {}}
      handleSave={async () => true}
      handleSaveForFile={async () => true}
      reloadContent={() => {}}
    />
  )
}

afterEach(cleanup)

describe('the refactor review branch of the editor', () => {
  it('mounts the review tab of the job the tab names', () => {
    renderContent(reviewFile)
    const tab = screen.getByTestId('refactor-review-tab')
    expect(tab.getAttribute('data-job-id')).toBe('job-1')
    expect(tab.getAttribute('data-worktree-id')).toBe('wt-1')
    expect(tab.getAttribute('data-relative-path')).toBe('src/foo.ts')
  })

  it('says the review is unavailable when the tab names no job', () => {
    const { refactorReview: _refactorReview, ...withoutJob } = reviewFile
    renderContent(withoutJob)
    expect(screen.getByText('The refactoring review is unavailable')).toBeTruthy()
    expect(screen.queryByTestId('refactor-review-tab')).toBeNull()
  })
})
