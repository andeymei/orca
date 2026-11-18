// @vitest-environment happy-dom
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import { afterEach, describe, expect, it } from 'vitest'
import type { NesEdit } from '../../../../../shared/code-completion/code-completion-types'
import { applyNesEdit, previewNesEdit } from './nes-edit-application'

const models: monaco.editor.ITextModel[] = []

function createModel(content: string): monaco.editor.ITextModel {
  const model = monaco.editor.createModel(content, 'plaintext')
  models.push(model)
  return model
}

/**
 * The editor half of the tests. The model is the real one, so the writes are real; the editor
 * only records the widgets it is given.
 */
function createFakeEditor(model: monaco.editor.ITextModel): {
  editorInstance: monaco.editor.IStandaloneCodeEditor
  widgets: monaco.editor.IContentWidget[]
  removedWidgets: monaco.editor.IContentWidget[]
  layoutCount: () => number
} {
  const widgets: monaco.editor.IContentWidget[] = []
  const removedWidgets: monaco.editor.IContentWidget[] = []
  let layouts = 0
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this editor double records the widgets it is given and delegates the undo stack to a real Monaco model.
  const editorInstance = {
    addContentWidget: (widget: monaco.editor.IContentWidget) => {
      widgets.push(widget)
    },
    removeContentWidget: (widget: monaco.editor.IContentWidget) => {
      removedWidgets.push(widget)
    },
    layoutContentWidget: () => {
      layouts += 1
    },
    pushUndoStop: () => {
      model.pushStackElement()
      return true
    }
  } as unknown as monaco.editor.IStandaloneCodeEditor
  return { editorInstance, widgets, removedWidgets, layoutCount: () => layouts }
}

function nesEdit(partial: Partial<NesEdit>): NesEdit {
  return {
    id: 'edit-1',
    path: 'src/app.ts',
    kind: 'insert',
    range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
    originalText: '',
    text: '',
    label: 'add a value',
    ...partial
  }
}

afterEach(() => {
  for (const model of models.splice(0)) {
    model.dispose()
  }
})

describe('applyNesEdit', () => {
  it('inserts the text at the cursor', async () => {
    const model = createModel('const value = 1')
    const { editorInstance } = createFakeEditor(model)

    const applied = applyNesEdit(
      model,
      editorInstance,
      nesEdit({
        range: { startLine: 1, startColumn: 16, endLine: 1, endColumn: 16 },
        text: ' + 2'
      })
    )

    expect(applied).toBe(true)
    expect(model.getValue()).toBe('const value = 1 + 2')
    expect(model.canUndo()).toBe(true)
    await model.undo()
    expect(model.getValue()).toBe('const value = 1')
  })

  it('replaces the range with the new text', () => {
    const model = createModel('const value = 1')
    const { editorInstance } = createFakeEditor(model)

    const applied = applyNesEdit(
      model,
      editorInstance,
      nesEdit({
        kind: 'replace',
        range: { startLine: 1, startColumn: 15, endLine: 1, endColumn: 16 },
        originalText: '1',
        text: '42'
      })
    )

    expect(applied).toBe(true)
    expect(model.getValue()).toBe('const value = 42')
  })

  it('deletes the range', () => {
    const model = createModel('const value = 1')
    const { editorInstance } = createFakeEditor(model)

    const applied = applyNesEdit(
      model,
      editorInstance,
      nesEdit({
        kind: 'delete',
        range: { startLine: 1, startColumn: 15, endLine: 1, endColumn: 16 },
        originalText: '1',
        text: ''
      })
    )

    expect(applied).toBe(true)
    expect(model.getValue()).toBe('const value = ')
  })

  it('refuses an edit whose original text no longer matches', () => {
    const model = createModel('const value = 1')
    const { editorInstance } = createFakeEditor(model)

    const applied = applyNesEdit(
      model,
      editorInstance,
      nesEdit({
        kind: 'replace',
        range: { startLine: 1, startColumn: 15, endLine: 1, endColumn: 16 },
        originalText: '2',
        text: '42'
      })
    )

    expect(applied).toBe(false)
  })

  it('leaves the model untouched when it refuses', () => {
    const model = createModel('const value = 1')
    const { editorInstance } = createFakeEditor(model)

    applyNesEdit(
      model,
      editorInstance,
      nesEdit({
        kind: 'replace',
        range: { startLine: 1, startColumn: 15, endLine: 1, endColumn: 16 },
        originalText: '2',
        text: '42'
      })
    )

    expect(model.getValue()).toBe('const value = 1')
    expect(model.canUndo()).toBe(false)
  })

  it('refuses an edit whose range leaves the text', () => {
    const model = createModel('const value = 1')
    const { editorInstance } = createFakeEditor(model)

    const applied = applyNesEdit(
      model,
      editorInstance,
      nesEdit({
        range: { startLine: 4, startColumn: 1, endLine: 4, endColumn: 1 },
        text: 'const other = 2'
      })
    )

    expect(applied).toBe(false)
    expect(model.getValue()).toBe('const value = 1')
  })
})

describe('previewNesEdit', () => {
  it('shows the new text without touching the model', () => {
    const model = createModel('const value = 1')
    const { editorInstance, widgets } = createFakeEditor(model)

    previewNesEdit(
      model,
      editorInstance,
      nesEdit({
        range: { startLine: 1, startColumn: 16, endLine: 1, endColumn: 16 },
        text: 'const other = 2'
      })
    )

    expect(widgets).toHaveLength(1)
    const node = widgets[0].getDomNode()
    expect(node?.textContent).toBe('const other = 2')
    expect(node?.classList.contains('nes-ghost-text')).toBe(true)
    expect(node?.style.pointerEvents).toBe('none')
    expect(model.getValue()).toBe('const value = 1')
    expect(model.canUndo()).toBe(false)
  })

  it('shows a multi-line edit as one element per line', () => {
    const model = createModel('const value = 1')
    const { editorInstance, widgets } = createFakeEditor(model)

    previewNesEdit(
      model,
      editorInstance,
      nesEdit({
        range: { startLine: 1, startColumn: 16, endLine: 1, endColumn: 16 },
        text: 'const other = 2\nconst third = 3'
      })
    )

    const node = widgets[0].getDomNode()
    expect(node?.children).toHaveLength(2)
    expect(node?.textContent).toBe('const other = 2\nconst third = 3')
  })

  it('shows the whole new text, not only the added part', () => {
    const model = createModel('const value = 1')
    const { editorInstance, widgets } = createFakeEditor(model)

    previewNesEdit(
      model,
      editorInstance,
      nesEdit({
        kind: 'replace',
        range: { startLine: 1, startColumn: 15, endLine: 1, endColumn: 16 },
        originalText: '1',
        text: '123'
      })
    )

    expect(widgets[0].getDomNode()?.textContent).toBe('123')
  })

  it('anchors the preview at the end of the edit, below its line', () => {
    const model = createModel('const value = 1')
    const { editorInstance, widgets, layoutCount } = createFakeEditor(model)

    previewNesEdit(
      model,
      editorInstance,
      nesEdit({
        range: { startLine: 1, startColumn: 15, endLine: 1, endColumn: 16 },
        originalText: '1',
        text: '42'
      })
    )

    const position = widgets[0].getPosition()
    expect(position?.position?.lineNumber).toBe(1)
    expect(position?.position?.column).toBe(16)
    expect(position?.preference).toEqual([monaco.editor.ContentWidgetPositionPreference.BELOW])
    expect(layoutCount()).toBe(1)
  })

  it('removes the widget when the preview is released', () => {
    const model = createModel('const value = 1')
    const { editorInstance, widgets, removedWidgets } = createFakeEditor(model)

    const release = previewNesEdit(
      model,
      editorInstance,
      nesEdit({
        range: { startLine: 1, startColumn: 16, endLine: 1, endColumn: 16 },
        text: 'const other = 2'
      })
    )

    expect(removedWidgets).toHaveLength(0)
    release()
    expect(removedWidgets).toHaveLength(1)
    expect(removedWidgets[0]).toBe(widgets[0])
    expect(model.getValue()).toBe('const value = 1')
  })
})
