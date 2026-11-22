import { describe, expect, it } from 'vitest'

import { createEditorTabsStore } from '@/store/slices/editor/editor-slice-test-harness'

describe('the unified tab of a refactoring review', () => {
  it('carries the name the open hands it, not the path of the file it reviews', () => {
    const store = createEditorTabsStore()
    store.getState().openFile(
      {
        filePath: 'wt-1::refactor-review:job-1',
        relativePath: 'src/foo.ts',
        worktreeId: 'wt-1',
        language: 'plaintext',
        mode: 'refactor-review'
      },
      { tabLabel: 'src/foo.ts (refactoring)' }
    )
    const tab = store
      .getState()
      .unifiedTabsByWorktree?.['wt-1']?.find((entry) => entry.contentType === 'refactor-review')
    expect(tab?.label).toBe('src/foo.ts (refactoring)')
  })

  it('falls back to the path of the file when the open names no tab', () => {
    const store = createEditorTabsStore()
    store.getState().openFile({
      filePath: 'src/foo.ts',
      relativePath: 'src/foo.ts',
      worktreeId: 'wt-1',
      language: 'plaintext',
      mode: 'edit'
    })
    const tab = store
      .getState()
      .unifiedTabsByWorktree?.['wt-1']?.find((entry) => entry.contentType === 'editor')
    expect(tab?.label).toBe('src/foo.ts')
  })
})
