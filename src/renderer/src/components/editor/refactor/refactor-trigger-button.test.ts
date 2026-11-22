import { describe, expect, it } from 'vitest'

import type { FileContent } from '../editor-panel-content-types'
import { refactorSourceContent } from './refactor-trigger-button'

function loaded(overrides: Partial<FileContent> = {}): FileContent {
  return {
    content: 'const a = 1\n',
    isBinary: false,
    ...overrides
  }
}

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
