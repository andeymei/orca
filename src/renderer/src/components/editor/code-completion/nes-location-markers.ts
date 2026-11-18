import type { editor } from 'monaco-editor'
import {
  nesEditExtendsCoveredText,
  type NesEdit
} from '../../../../../shared/code-completion/code-completion-types'
import { nesEditMatchesPosition, type NesCursorPosition } from './nes-plan-store'

/** One plan edit that gets a gutter marker, and the line the marker sits on. */
export type NesLocationMarker = {
  edit: NesEdit
  lineNumber: number
}

/**
 * The edits that get a gutter marker. The cursor edit leaves the list when it extends the covered
 * text, because that one is the suggestion itself and a marker would draw the user to the line
 * they are already on. A cursor edit that only rewrites the covered text is never offered inline,
 * so it keeps its marker — that marker is the only way to reach it.
 */
export function nesLocationMarkers(
  edits: readonly NesEdit[],
  cursor: NesCursorPosition
): NesLocationMarker[] {
  return edits
    .filter((edit) => !(nesEditMatchesPosition(edit, cursor) && nesEditExtendsCoveredText(edit)))
    .map((edit) => ({ edit, lineNumber: edit.range.startLine }))
}

/**
 * The gutter glyph of the first marker on each line, built without a Monaco instance so its shape
 * can be pinned.
 */
export function nesMarkerDecorations(
  markers: readonly NesLocationMarker[]
): editor.IModelDeltaDecoration[] {
  const decorations: editor.IModelDeltaDecoration[] = []
  const drawnLines = new Set<number>()
  for (const marker of markers) {
    // Why: the glyph margin draws one glyph per line, so a second marker's hover would be unreachable.
    if (drawnLines.has(marker.lineNumber)) {
      continue
    }
    drawnLines.add(marker.lineNumber)
    decorations.push({
      range: {
        startLineNumber: marker.lineNumber,
        startColumn: 1,
        endLineNumber: marker.lineNumber,
        endColumn: 1
      },
      options: {
        glyphMarginClassName: 'nes-location-marker',
        glyphMarginHoverMessage: { value: `${marker.edit.kind}: ${marker.edit.label}` },
        isWholeLine: false
      }
    })
  }
  return decorations
}

/** The collection the editor hook refreshes on each tick; disposing it is the hook's job. */
export function createNesMarkerDecorations(
  editorInstance: editor.IStandaloneCodeEditor,
  markers: readonly NesLocationMarker[]
): editor.IEditorDecorationsCollection {
  const collection = editorInstance.createDecorationsCollection()
  collection.set(nesMarkerDecorations(markers))
  return collection
}
