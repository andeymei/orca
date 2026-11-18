import type { editor } from 'monaco-editor'
import { ContentWidgetPositionPreference } from 'monaco-editor/esm/vs/editor/common/standalone/standaloneEnums.js'
import {
  sliceRange,
  type NesEdit
} from '../../../../../shared/code-completion/code-completion-types'

/** Monaco keys its content widgets by id, so every preview needs an id of its own. */
let previewCount = 0

/**
 * Writes an accepted edit into the model, and refuses it when the text it was made against is gone.
 */
export function applyNesEdit(
  model: editor.ITextModel,
  editorInstance: editor.IStandaloneCodeEditor,
  edit: NesEdit
): boolean {
  const coveredText = sliceRange(model.getValue(), edit.range)
  // Why: the file changed under the plan, so the text the edit was made against is no longer there.
  if (coveredText !== edit.originalText) {
    return false
  }
  editorInstance.pushUndoStop()
  model.pushEditOperations(
    [],
    [
      {
        range: {
          startLineNumber: edit.range.startLine,
          startColumn: edit.range.startColumn,
          endLineNumber: edit.range.endLine,
          endColumn: edit.range.endColumn
        },
        // Why: Monaco spells a deletion as a null text.
        text: edit.kind === 'delete' ? null : edit.text
      }
    ],
    () => null
  )
  editorInstance.pushUndoStop()
  return true
}

/**
 * Draws the edit's new text over the code, and returns the function that takes it away again.
 */
export function previewNesEdit(
  model: editor.ITextModel,
  editorInstance: editor.IStandaloneCodeEditor,
  edit: NesEdit
): () => void {
  const node = document.createElement('div')
  node.className = 'nes-ghost-text'
  // Why: the user must still be able to click the code the preview lies over.
  node.style.pointerEvents = 'none'
  const lines = edit.text.split(/\r\n|\r|\n/)
  lines.forEach((line, index) => {
    const lineNode = document.createElement('span')
    // Why: the newline rides on the line it ends, so an empty line keeps its height.
    lineNode.textContent = index < lines.length - 1 ? `${line}\n` : line
    node.appendChild(lineNode)
  })
  const anchor = model.validatePosition({
    lineNumber: edit.range.endLine,
    column: edit.range.endColumn
  })
  const widgetId = `orca.nes-preview.${previewCount}`
  previewCount += 1
  const widget: editor.IContentWidget = {
    allowEditorOverflow: true,
    getId: () => widgetId,
    getDomNode: () => node,
    getPosition: () => ({
      position: { lineNumber: anchor.lineNumber, column: anchor.column },
      preference: [ContentWidgetPositionPreference.BELOW]
    })
  }
  editorInstance.addContentWidget(widget)
  editorInstance.layoutContentWidget(widget)
  return () => {
    editorInstance.removeContentWidget(widget)
  }
}
