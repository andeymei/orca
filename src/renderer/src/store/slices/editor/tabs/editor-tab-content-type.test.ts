import { describe, expect, it } from 'vitest'
import { editorTabContentTypeForMode, isVirtualEditorFile } from './editor-tab-content-type'

describe('the refactor review tab', () => {
  it('is its own tab content type', () => {
    expect(editorTabContentTypeForMode('refactor-review')).toBe('refactor-review')
  })

  it('is a virtual editor file, not a file on disk', () => {
    expect(isVirtualEditorFile({ mode: 'refactor-review' })).toBe(true)
  })
})
