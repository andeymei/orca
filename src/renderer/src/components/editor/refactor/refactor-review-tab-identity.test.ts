import { Sparkles } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'

import { makeOpenFile } from '@/store/slices/editor/types/open-file.test-fixture'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string | number>) =>
    fallback.replace(/{{(\w+)}}/g, (_match, name) => String(values?.[name] ?? ''))
}))

import { getEditorDisplayLabel } from '../panel/header/editor-labels'
import { getEditorFileTabModeIcon } from '../../tab-bar/editor-tabs/editor-file-tab-mode-icon'
import { recentTabSwitcherIcon } from '../../tab-bar/recent-tab-switcher-icon'

const reviewFile = makeOpenFile({
  id: 'wt-1::refactor-review:job-1',
  worktreeId: 'wt-1',
  mode: 'refactor-review',
  filePath: 'wt-1::refactor-review:job-1',
  relativePath: 'src/foo.ts'
})

describe('the review tab in the tab strip', () => {
  it('is named after the file it reviews, so the strip does not show it twice', () => {
    expect(getEditorDisplayLabel(reviewFile, 'fileName')).toBe('foo.ts (refactoring)')
  })

  it('has an icon of its own, so it does not look like the file tab', () => {
    expect(getEditorFileTabModeIcon(reviewFile)).toBe(Sparkles)
  })

  it('has an icon of its own in the switcher overlay, which names tabs by their own label', () => {
    expect(
      recentTabSwitcherIcon({
        type: 'editor',
        id: reviewFile.id,
        key: reviewFile.id,
        label: 'src/foo.ts (refactoring)',
        contentType: 'refactor-review',
        isDirty: false
      })
    ).toBe(Sparkles)
  })
})
