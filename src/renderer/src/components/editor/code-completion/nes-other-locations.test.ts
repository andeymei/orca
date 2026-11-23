import { describe, expect, it } from 'vitest'
import type { NesEdit } from '../../../../../shared/code-completion/code-completion-types'
import { nesOtherLocations } from './nes-other-locations'

const APP_PATH = '/repo/src/app.ts'

function makeEdit(overrides: Partial<NesEdit> = {}): NesEdit {
  return {
    id: 'edit-1',
    path: APP_PATH,
    kind: 'replace',
    range: { startLine: 10, startColumn: 5, endLine: 10, endColumn: 12 },
    originalText: 'const a = 1',
    text: 'const a = 2',
    label: 'rename the constant',
    ...overrides
  }
}

describe('nes other locations', () => {
  it('leaves out the edit whose range ends at the cursor', () => {
    const locations = nesOtherLocations(
      [
        makeEdit({
          id: 'cursor-edit',
          kind: 'insert',
          range: { startLine: 10, startColumn: 12, endLine: 10, endColumn: 12 },
          originalText: '',
          text: 'const a = 1'
        }),
        makeEdit({
          id: 'other-edit',
          range: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 8 }
        })
      ],
      { lineNumber: 10, column: 12 }
    )

    expect(locations.map((edit) => edit.id)).toEqual(['other-edit'])
  })

  it('keeps a cursor edit that only rewrites', () => {
    const locations = nesOtherLocations(
      [
        makeEdit({
          id: 'rewriting-cursor-edit',
          kind: 'replace',
          originalText: 'const a = 1',
          text: 'const a = 2'
        })
      ],
      { lineNumber: 10, column: 12 }
    )

    // Why: the list keeps the edit; the editor leaves out the one it draws as the suggestion.
    expect(locations.map((edit) => edit.id)).toEqual(['rewriting-cursor-edit'])
  })
})
