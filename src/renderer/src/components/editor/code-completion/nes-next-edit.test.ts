import { describe, expect, it } from 'vitest'
import type { NesEdit } from '../../../../../shared/code-completion/code-completion-types'
import type { NesLocationMarker } from './nes-location-markers'
import { nesNextEditNotice } from './nes-next-edit'

const FILE_PATH = '/repo/src/app.ts'

function makeEdit(overrides: Partial<NesEdit> = {}): NesEdit {
  return {
    id: 'edit-1',
    path: FILE_PATH,
    kind: 'replace',
    range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 12 },
    originalText: 'const a = 1',
    text: 'const a = 12',
    label: 'extend the constant',
    ...overrides
  }
}

function makeMarker(edit: NesEdit): NesLocationMarker {
  return { edit, lineNumber: edit.range.startLine }
}

describe('the next-edit notice', () => {
  it('says nothing when the cursor shows the whole plan', () => {
    const drawn = makeEdit()
    expect(
      nesNextEditNotice({
        drawn,
        drawnIsDrawable: true,
        markers: [],
        cursor: { lineNumber: 1, column: 12 }
      })
    ).toBeNull()
  })

  it('says nothing when the cursor already shows a suggestion', () => {
    // Why: the ghost text is on the screen, so a chip beside it would only be noise.
    const elsewhere = makeEdit({
      id: 'edit-2',
      range: { startLine: 9, startColumn: 1, endLine: 9, endColumn: 1 },
      label: 'add the import'
    })
    expect(
      nesNextEditNotice({
        drawn: makeEdit(),
        drawnIsDrawable: true,
        markers: [makeMarker(elsewhere)],
        cursor: { lineNumber: 1, column: 12 }
      })
    ).toBeNull()
  })

  it('names the edit the cursor cannot draw', () => {
    const drawn = makeEdit({
      range: { startLine: 7, startColumn: 3, endLine: 7, endColumn: 8 },
      label: 'rename the constant'
    })
    expect(
      nesNextEditNotice({
        drawn,
        drawnIsDrawable: false,
        markers: [],
        cursor: { lineNumber: 7, column: 8 }
      })
    ).toEqual({ kind: 'rewrite', lineNumber: 7, label: 'rename the constant' })
  })

  it('points at the next edit when the plan holds one elsewhere', () => {
    const elsewhere = makeEdit({
      id: 'edit-2',
      range: { startLine: 9, startColumn: 1, endLine: 9, endColumn: 1 },
      label: 'add the import'
    })
    expect(
      nesNextEditNotice({
        drawn: null,
        drawnIsDrawable: false,
        markers: [makeMarker(elsewhere)],
        cursor: { lineNumber: 2, column: 1 }
      })
    ).toEqual({ kind: 'elsewhere', lineNumber: 9, label: 'add the import' })
  })

  it('points at the edit after the cursor, not the first one', () => {
    const before = makeEdit({
      id: 'edit-2',
      range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      label: 'an edit above'
    })
    const after = makeEdit({
      id: 'edit-3',
      range: { startLine: 20, startColumn: 1, endLine: 20, endColumn: 1 },
      label: 'an edit below'
    })
    expect(
      nesNextEditNotice({
        drawn: null,
        drawnIsDrawable: false,
        markers: [makeMarker(before), makeMarker(after)],
        cursor: { lineNumber: 5, column: 1 }
      })
    ).toEqual({ kind: 'elsewhere', lineNumber: 20, label: 'an edit below' })
  })

  it('says nothing without a cursor to point from', () => {
    expect(
      nesNextEditNotice({
        drawn: null,
        drawnIsDrawable: false,
        markers: [makeMarker(makeEdit())],
        cursor: null
      })
    ).toBeNull()
  })
})
