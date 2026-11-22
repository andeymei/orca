import {
  nesEditExtendsCoveredText,
  type NesEdit
} from '../../../../../shared/code-completion/code-completion-types'
import { nesEditMatchesPosition, type NesCursorPosition } from './nes-plan-store'

/**
 * The plan's edits that sit somewhere other than the cursor.
 *
 * Why: the edit at the cursor that the editor draws as the suggestion is not somewhere else, so
 * it leaves the list. A rewrite at the cursor stays, because the editor cannot draw it there.
 */
export function nesOtherLocations(edits: readonly NesEdit[], cursor: NesCursorPosition): NesEdit[] {
  return edits.filter(
    (edit) => !(nesEditMatchesPosition(edit, cursor) && nesEditExtendsCoveredText(edit))
  )
}

/** The location after the cursor; the list cycles, so the last one leads back to the first. */
export function nesNextLocationAfter(
  locations: readonly NesEdit[],
  position: NesCursorPosition
): NesEdit | null {
  if (locations.length === 0) {
    return null
  }
  const after = locations.find((edit) => isAfterCursor(edit, position))
  return after ?? locations[0]
}

function isAfterCursor(edit: NesEdit, position: NesCursorPosition): boolean {
  if (edit.range.endLine !== position.lineNumber) {
    return edit.range.endLine > position.lineNumber
  }
  return edit.range.endColumn > position.column
}
