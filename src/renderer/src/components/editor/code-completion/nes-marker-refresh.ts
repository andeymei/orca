import type { editor } from 'monaco-editor'
import { nesInlineCompletionForEdit } from './nes-inline-provider'
import {
  nesLocationMarkers,
  nesMarkerDecorations,
  type NesLocationMarker
} from './nes-location-markers'
import { nesNextEditNotice, type NesNextEdit } from './nes-next-edit'
import { nesPlanStore } from './nes-plan-store'

/**
 * The markers the plan's edits carry, and the notice that names the place the cursor cannot show.
 *
 * Why the edit under the cursor leaves the list: it is the suggestion itself, so a marker would
 * point the user at the line they are already on.
 */
export function refreshNesMarkers(input: {
  editorInstance: editor.IStandaloneCodeEditor
  /** The file the plan belongs to. */
  filePath: string
  /** The key the plan store binds the model under. */
  modelKey: string
  collection: editor.IEditorDecorationsCollection
  onMarkersChanged: (count: number) => void
  onNextEditChanged: (
    next: NesNextEdit | null | ((previous: NesNextEdit | null) => NesNextEdit | null)
  ) => void
}): NesLocationMarker[] {
  const position = input.editorInstance.getPosition()
  const model = input.editorInstance.getModel()
  const drawn = position && model ? editAtCursor(input.modelKey, position) : null
  const drawnIsDrawable = Boolean(
    drawn && model && nesInlineCompletionForEdit(drawn, model) !== null
  )
  const shown = drawnIsDrawable
    ? nesPlanStore.editsForPath(input.filePath).filter((edit) => edit !== drawn)
    : nesPlanStore.editsForPath(input.filePath)
  const markers = position
    ? nesLocationMarkers(shown, position).sort((left, right) => left.lineNumber - right.lineNumber)
    : []
  input.collection.set(nesMarkerDecorations(markers))
  input.onMarkersChanged(markers.length)
  const notice = nesNextEditNotice({
    drawn,
    drawnIsDrawable,
    markers,
    cursor: position
  })
  input.onNextEditChanged((previous) => {
    // Why: the notice is rebuilt on every cursor move, so an unchanged one must keep its
    // identity or the editor re-renders on every keypress.
    if (
      previous &&
      notice &&
      previous.kind === notice.kind &&
      previous.lineNumber === notice.lineNumber &&
      previous.label === notice.label
    ) {
      return previous
    }
    return notice
  })
  return markers
}

/** The edit of the bound file whose range ends at the cursor, if there is one. */
function editAtCursor(
  modelKey: string,
  position: { lineNumber: number; column: number }
): ReturnType<typeof nesPlanStore.editAt> {
  return nesPlanStore.editAt(modelKey, position)
}
