import type { editor } from 'monaco-editor'
import { nesInlineCompletionForEdit } from './nes-inline-provider'
import { nesOtherLocations } from './nes-other-locations'
import { nesNextEditNotice, type NesNextEdit } from './nes-next-edit'
import { nesPlanStore } from './nes-plan-store'
import type { NesEdit } from '../../../../../shared/code-completion/code-completion-types'

/**
 * The places the plan predicts, and the notice that names the place the cursor cannot show.
 *
 * Why the edit under the cursor leaves the list: it is the suggestion itself, so a place the
 * person is already on would say nothing.
 */
export function refreshNesNextEdit(input: {
  editorInstance: editor.IStandaloneCodeEditor
  /** The file the plan belongs to. */
  filePath: string
  /** The key the plan store binds the model under. */
  modelKey: string
  onNextEditChanged: (
    next: NesNextEdit | null | ((previous: NesNextEdit | null) => NesNextEdit | null)
  ) => void
}): NesEdit[] {
  const position = input.editorInstance.getPosition()
  const model = input.editorInstance.getModel()
  const drawn = position && model ? editAtCursor(input.modelKey, position) : null
  const drawnIsDrawable = Boolean(
    drawn && model && nesInlineCompletionForEdit(drawn, model) !== null
  )
  const edits = nesPlanStore.editsForPath(input.filePath)
  const locations = position
    ? nesOtherLocations(
        drawnIsDrawable ? edits.filter((edit) => edit !== drawn) : edits,
        position
      ).sort((left, right) => left.range.startLine - right.range.startLine)
    : []
  const notice = nesNextEditNotice({
    drawn,
    drawnIsDrawable,
    locations,
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
  return locations
}

/** The edit of the bound file whose range ends at the cursor, if there is one. */
function editAtCursor(
  modelKey: string,
  position: { lineNumber: number; column: number }
): ReturnType<typeof nesPlanStore.editAt> {
  return nesPlanStore.editAt(modelKey, position)
}
