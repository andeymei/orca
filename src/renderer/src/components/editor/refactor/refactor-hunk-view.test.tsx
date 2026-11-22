// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RefactorHunk } from '../../../../../shared/refactor/refactor-types'
import { RefactorHunkView } from './refactor-hunk-view'

type CapturedDiffEditor = {
  original?: string
  modified?: string
  originalModelPath?: string
  modifiedModelPath?: string
}

type StoreFixture = {
  settings: {
    diffWordWrap: boolean
    diffShowWhitespace: boolean
    diffCollapseUnchangedRegions: boolean
  }
  addDiffComment: (comment: unknown) => Promise<unknown>
  deleteDiffComment: (id: string) => Promise<unknown>
  updateDiffComment: (id: string, body: string) => Promise<unknown>
  scrollToDiffCommentId: string | null
  setScrollToDiffCommentId: (id: string | null) => void
}

const captured = vi.hoisted(() => {
  const diffEditors: CapturedDiffEditor[] = []
  const pluginSyntaxPaths: string[] = []
  return { diffEditors, pluginSyntaxPaths }
})

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: (props: CapturedDiffEditor) => {
    captured.diffEditors.push(props)
    return <div data-testid="monaco-diff" />
  }
}))
vi.mock('@/store/index', () => ({
  useAppStore: <T,>(selector: (state: StoreFixture) => T) =>
    selector({
      settings: {
        diffWordWrap: true,
        diffShowWhitespace: false,
        diffCollapseUnchangedRegions: false
      },
      addDiffComment: vi.fn(),
      deleteDiffComment: vi.fn(),
      updateDiffComment: vi.fn(),
      scrollToDiffCommentId: null,
      setScrollToDiffCommentId: vi.fn()
    })
}))
vi.mock('@/store/slices/diff-comments/diff-comment-owner', () => ({
  sourceParts: () => [],
  createDiffCommentViewSelector: () => () => ({ owner: null, comments: undefined }),
  createOwnedDiffCommentsSelector: () => () => undefined,
  selectDiffCommentView: () => ({ owner: null, comments: undefined }),
  diffCommentOwnerKey: () => ''
}))
vi.mock('@/lib/editor/monaco/monaco-setup', () => ({
  monaco: { Uri: { parse: (path: string) => path }, editor: { getModel: () => null } }
}))
vi.mock('@/lib/monaco-languages/plugin-syntax-editor-options', () => ({
  PLUGIN_SYNTAX_EDITOR_OPTIONS: {},
  applyModelLanguage: vi.fn()
}))
vi.mock('../useContextualCopySetup', () => ({
  useContextualCopySetup: () => ({ setupCopy: vi.fn(), toastNode: null })
}))
// DiffViewer hands its filePath to the plugin-syntax lookup; that is where the workspace path shows up.
vi.mock('../use-plugin-syntax-language', () => ({
  usePluginSyntaxLanguage: (filePath: string, coreLanguage: string) => {
    captured.pluginSyntaxPaths.push(filePath)
    return coreLanguage
  }
}))
vi.mock('../../diff-comments/useDiffCommentDecorator', () => ({
  useDiffCommentDecorator: vi.fn()
}))
vi.mock('@/hooks/use-document-dark-theme', () => ({ useDocumentDarkTheme: () => false }))
vi.mock('../diff/monaco-view/diff-editor-line-number-options', () => ({
  applyDiffEditorLineNumberOptions: () => ({ dispose: vi.fn() })
}))
vi.mock('../diff/monaco-view/diff-editor-word-wrap-options', () => ({
  buildDiffEditorWordWrapOptions: () => ({}),
  syncDiffEditorOriginalWordWrap: () => ({ dispose: vi.fn() })
}))
vi.mock('../diff/monaco-view/diff-model-swap-view-state', () => ({
  preserveDiffViewStateAcrossModelSwaps: () => ({ dispose: vi.fn() })
}))
vi.mock('../diff/monaco-view/useDiffViewerFirstChangeAutoScroll', () => ({
  useDiffViewerFirstChangeAutoScroll: vi.fn()
}))
vi.mock('../diff/large-files/LargeDiffFallback', () => ({
  LargeDiffFallback: () => <div>Large diff</div>
}))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string>) =>
    fallback.replace(/{{(\w+)}}/g, (_match, name) => values?.[name] ?? '')
}))

const HUNK: RefactorHunk = {
  id: 'h1',
  originalStartLine: 42,
  originalLineCount: 17,
  modifiedStartLine: 42,
  modifiedLineCount: 3,
  originalText: 'old\n',
  modifiedText: 'new\n'
}

const props = {
  hunk: HUNK,
  filePath: '/repo/src/foo.ts',
  relativePath: 'src/foo.ts',
  ownerKey: 'wt-1::refactor-review:job-1',
  accepted: false,
  sideBySide: true,
  onToggleAccepted: () => {}
}

/** The diff chunk loads lazily, and the first load pulls Monaco in. */
async function findDiffEditor(): Promise<HTMLElement> {
  return screen.findByTestId('monaco-diff', undefined, { timeout: 10_000 })
}

afterEach(() => {
  cleanup()
  captured.diffEditors.length = 0
  captured.pluginSyntaxPaths.length = 0
})

describe('the refactoring hunk view', () => {
  it('shows the absolute line range of the hunk', async () => {
    render(<RefactorHunkView {...props} />)
    expect(screen.getByText('第 42-58 行')).toBeTruthy()
    await findDiffEditor()
  })

  it('shows a pure insertion as the single line it lands on', async () => {
    render(<RefactorHunkView {...props} hunk={{ ...HUNK, originalLineCount: 0 }} />)
    expect(screen.getByText('第 42 行')).toBeTruthy()
    await findDiffEditor()
  })

  it('shows an accept control that reports the click', async () => {
    const onToggleAccepted = vi.fn()
    render(<RefactorHunkView {...props} onToggleAccepted={onToggleAccepted} />)
    fireEvent.click(screen.getByRole('button', { name: '接受' }))
    expect(onToggleAccepted).toHaveBeenCalled()
    await findDiffEditor()
  })

  it('marks an accepted hunk as accepted', async () => {
    render(<RefactorHunkView {...props} accepted />)
    expect(screen.getByRole('button', { name: '已接受' })).toBeTruthy()
    await findDiffEditor()
  })

  it('shows the check only once the hunk is accepted', async () => {
    const view = render(<RefactorHunkView {...props} />)
    expect(view.container.querySelector('.lucide-circle-check')).toBeNull()
    expect(view.container.querySelector('.lucide-circle')).toBeTruthy()
    view.rerender(<RefactorHunkView {...props} accepted />)
    expect(view.container.querySelector('.lucide-circle-check')).toBeTruthy()
    await findDiffEditor()
  })

  it('gives the diff the workspace path of the file it shows', async () => {
    render(<RefactorHunkView {...props} />)
    await findDiffEditor()
    expect(captured.pluginSyntaxPaths).toContain('/repo/src/foo.ts')
  })

  it('gives every hunk of the tab its own model under the tab that owns it', async () => {
    render(
      <>
        <RefactorHunkView {...props} />
        <RefactorHunkView {...props} hunk={{ ...HUNK, id: 'h2' }} />
      </>
    )
    await screen.findAllByTestId('monaco-diff', undefined, { timeout: 10_000 })

    const [first, second] = captured.diffEditors
    expect(first?.originalModelPath).not.toBe(second?.originalModelPath)

    // The owner slot holds the review tab; the file and the hunk live in the model slot.
    // The URI escapes a colon as ~3A, so the hunk id ends the model slot.
    const [, , owner, model] = (first?.originalModelPath ?? '').split(':')
    expect(owner).toContain('refactor-review')
    expect(owner).not.toContain('foo.ts')
    expect(model).toContain('foo.ts')
    expect(model.endsWith('~3Ah1')).toBe(true)
  })

  it('shows the hunk text in the diff', async () => {
    render(<RefactorHunkView {...props} />)
    await findDiffEditor()
    const [diffEditor] = captured.diffEditors
    expect(diffEditor?.original).toBe('old\n')
    expect(diffEditor?.modified).toBe('new\n')
  })
})
