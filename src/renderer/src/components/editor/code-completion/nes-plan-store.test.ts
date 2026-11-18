import { describe, expect, it } from 'vitest'
import type { NesEdit } from '../../../../../shared/code-completion/code-completion-types'
import { createNesPlanStore } from './nes-plan-store'
import { nesLocationMarkers, nesMarkerDecorations } from './nes-location-markers'

const APP_PATH = '/repo/src/app.ts'
const OTHER_PATH = '/repo/src/other.ts'
const APP_MODEL_KEY = 'vscode-remote://owner-hash/repo/src/app.ts'

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

describe('nes plan store', () => {
  it('finds the edit whose range ends at the cursor', () => {
    const store = createNesPlanStore()
    store.bindModel(APP_MODEL_KEY, APP_PATH)
    store.setPlan(APP_PATH, { edits: [makeEdit()] })

    expect(store.editAt(APP_MODEL_KEY, { lineNumber: 10, column: 12 })).toEqual(makeEdit())
  })

  it('finds nothing when the cursor moved past the edit', () => {
    const store = createNesPlanStore()
    store.bindModel(APP_MODEL_KEY, APP_PATH)
    store.setPlan(APP_PATH, { edits: [makeEdit()] })

    expect(store.editAt(APP_MODEL_KEY, { lineNumber: 10, column: 13 })).toBeNull()
  })

  it('finds nothing when the cursor moved before the edit', () => {
    const store = createNesPlanStore()
    store.bindModel(APP_MODEL_KEY, APP_PATH)
    store.setPlan(APP_PATH, { edits: [makeEdit()] })

    expect(store.editAt(APP_MODEL_KEY, { lineNumber: 10, column: 11 })).toBeNull()
    expect(store.editAt(APP_MODEL_KEY, { lineNumber: 9, column: 12 })).toBeNull()
  })

  it('resolves a bound model to the plan of its file', () => {
    const store = createNesPlanStore()
    store.setPlan(APP_PATH, { edits: [makeEdit({ id: 'app-edit' })] })
    store.setPlan(OTHER_PATH, {
      edits: [
        makeEdit({
          id: 'other-edit',
          path: OTHER_PATH,
          range: { startLine: 10, startColumn: 5, endLine: 10, endColumn: 12 }
        })
      ]
    })
    store.bindModel(APP_MODEL_KEY, APP_PATH)

    expect(store.getPlan(APP_PATH)?.edits[0]?.id).toBe('app-edit')
    expect(store.editAt(APP_MODEL_KEY, { lineNumber: 10, column: 12 })?.id).toBe('app-edit')
  })

  it('lists the edits of another file that a plan mentions', () => {
    const store = createNesPlanStore()
    store.setPlan(APP_PATH, {
      edits: [
        makeEdit({ id: 'app-edit' }),
        makeEdit({
          id: 'other-edit',
          path: OTHER_PATH,
          range: { startLine: 4, startColumn: 1, endLine: 4, endColumn: 9 }
        })
      ]
    })

    expect(store.editsForPath(OTHER_PATH).map((edit) => edit.id)).toEqual(['other-edit'])
  })

  it('does not list an edit of a file the plan never named', () => {
    const store = createNesPlanStore()
    store.setPlan(APP_PATH, { edits: [makeEdit()] })

    expect(store.editsForPath('/repo/src/never-mentioned.ts')).toEqual([])
  })

  it('takes the first of the two edits that sit at the same position', () => {
    const importEdit = makeEdit({
      id: 'import-edit',
      kind: 'insert',
      range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      originalText: '',
      text: "import { readFile } from 'node:fs/promises'"
    })
    const cursorEdit = makeEdit({
      id: 'cursor-edit',
      kind: 'insert',
      range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      originalText: '',
      text: 'const a = 1'
    })
    const store = createNesPlanStore()
    store.bindModel(APP_MODEL_KEY, APP_PATH)

    store.setPlan(APP_PATH, { edits: [importEdit, cursorEdit] })
    expect(store.editAt(APP_MODEL_KEY, { lineNumber: 1, column: 1 })?.id).toBe('import-edit')

    store.setPlan(APP_PATH, { edits: [cursorEdit, importEdit] })
    expect(store.editAt(APP_MODEL_KEY, { lineNumber: 1, column: 1 })?.id).toBe('cursor-edit')
  })

  it('does not return an edit of another file', () => {
    const store = createNesPlanStore()
    store.bindModel(APP_MODEL_KEY, APP_PATH)
    store.setPlan(APP_PATH, {
      edits: [
        makeEdit({
          id: 'other-edit',
          path: OTHER_PATH,
          range: { startLine: 10, startColumn: 5, endLine: 10, endColumn: 12 }
        })
      ]
    })

    expect(store.editAt(APP_MODEL_KEY, { lineNumber: 10, column: 12 })).toBeNull()
  })

  it('finds nothing for a model it never bound', () => {
    const store = createNesPlanStore()
    store.setPlan(APP_PATH, { edits: [makeEdit()] })

    expect(
      store.editAt('vscode-remote://owner-hash/repo/src/unbound.ts', { lineNumber: 10, column: 12 })
    ).toBeNull()
  })

  it('forgets a model that was unbound', () => {
    const store = createNesPlanStore()
    store.bindModel(APP_MODEL_KEY, APP_PATH)
    store.setPlan(APP_PATH, { edits: [makeEdit()] })

    store.unbindModel(APP_MODEL_KEY)

    expect(store.editAt(APP_MODEL_KEY, { lineNumber: 10, column: 12 })).toBeNull()
    expect(store.getPlan(APP_PATH)).toEqual({ edits: [makeEdit()] })
  })

  it('drops the plan of a file it removes', () => {
    const store = createNesPlanStore()
    store.bindModel(APP_MODEL_KEY, APP_PATH)
    store.setPlan(APP_PATH, { edits: [makeEdit()] })

    store.remove(APP_PATH)

    expect(store.getPlan(APP_PATH)).toBeNull()
    expect(store.editAt(APP_MODEL_KEY, { lineNumber: 10, column: 12 })).toBeNull()
  })

  it('forgets every plan and binding when it clears', () => {
    const store = createNesPlanStore()
    store.bindModel(APP_MODEL_KEY, APP_PATH)
    store.setPlan(APP_PATH, { edits: [makeEdit()] })

    store.clear()

    expect(store.getPlan(APP_PATH)).toBeNull()
    expect(store.editsForPath(APP_PATH)).toEqual([])
    expect(store.editAt(APP_MODEL_KEY, { lineNumber: 10, column: 12 })).toBeNull()
  })
})

describe('nes location markers', () => {
  it('leaves out the edit whose range ends at the cursor', () => {
    const markers = nesLocationMarkers(
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

    expect(markers.map((marker) => marker.edit.id)).toEqual(['other-edit'])
  })

  it('keeps the marker for a cursor edit that only rewrites', () => {
    const markers = nesLocationMarkers(
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

    expect(markers.map((marker) => marker.edit.id)).toEqual(['rewriting-cursor-edit'])
  })

  it('marks an edit at another line with the line it starts on', () => {
    const markers = nesLocationMarkers(
      [
        makeEdit({
          id: 'other-edit',
          range: { startLine: 20, startColumn: 3, endLine: 22, endColumn: 8 }
        })
      ],
      { lineNumber: 10, column: 12 }
    )

    expect(markers.map((marker) => marker.edit.id)).toEqual(['other-edit'])
    expect(markers[0]?.lineNumber).toBe(20)
  })
})

describe('nes marker decorations', () => {
  it('puts the glyph on the marker line, in the gutter', () => {
    const [decoration] = nesMarkerDecorations([{ edit: makeEdit(), lineNumber: 10 }])

    expect(decoration?.range).toEqual({
      startLineNumber: 10,
      startColumn: 1,
      endLineNumber: 10,
      endColumn: 1
    })
    expect(decoration?.options.glyphMarginClassName).toBe('nes-location-marker')
    expect(decoration?.options.isWholeLine).toBe(false)
  })

  it('carries the edit label in the hover message', () => {
    const [decoration] = nesMarkerDecorations([
      { edit: makeEdit({ label: 'rename the constant' }), lineNumber: 10 }
    ])

    expect(decoration?.options.glyphMarginHoverMessage).toEqual({
      value: 'replace: rename the constant'
    })
  })
})
