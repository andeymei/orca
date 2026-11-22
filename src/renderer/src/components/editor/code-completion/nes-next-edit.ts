import type { NesEdit } from '../../../../../shared/code-completion/code-completion-types'
import type { NesCursorPosition } from './nes-plan-store'
import type { NesLocationMarker } from './nes-location-markers'

/**
 * The edit the editor cannot show where the user is typing, and what the notice says about it.
 *
 * A plan that carries an edit elsewhere in the file leaves a gutter marker, and a marker alone
 * reads as nothing happened. The notice names the place, so a suggestion is never invisible.
 */
export type NesNextEdit = {
  /**
   * `elsewhere` is an edit in another part of the file, which the notice can point at.
   * `rewrite` is an edit at the cursor that rewrites the text it covers, which only a preview
   * can show — a ghost text draws no deletion.
   */
  kind: 'elsewhere' | 'rewrite'
  lineNumber: number
  /** The model's own words, so the notice can name the edit without translating it. */
  label: string
}

/**
 * The notice the editor shows for the plan it holds, or null when the cursor shows everything.
 *
 * Why: the editor draws a suggestion only where the cursor is, so a plan that says something
 * elsewhere has to say so out loud. Without this, the user sees nothing and concludes the feature
 * is broken. The notice is for a cursor that shows nothing at all — a suggestion that is already
 * on the screen is its own notice, and a chip beside it would only be noise.
 */
export function nesNextEditNotice(input: {
  /** The edit whose range ends at the cursor, when the plan holds one there. */
  drawn: NesEdit | null
  /** Whether the editor can draw that edit where the cursor is. */
  drawnIsDrawable: boolean
  /** The edits that carry a gutter marker. */
  markers: readonly NesLocationMarker[]
  cursor: NesCursorPosition | null
}): NesNextEdit | null {
  if (input.drawn) {
    // Why: a rewrite at the cursor is the one edit the cursor cannot show, so it is named.
    if (input.drawnIsDrawable) {
      return null
    }
    return {
      kind: 'rewrite',
      lineNumber: input.drawn.range.startLine,
      label: input.drawn.label
    }
  }
  if (!input.cursor) {
    return null
  }
  const next = nextMarkerAfter(input.markers, input.cursor)
  if (!next) {
    return null
  }
  return {
    kind: 'elsewhere',
    lineNumber: next.edit.range.startLine,
    label: next.edit.label
  }
}

/** The location after the cursor; the list cycles, so the last one leads back to the first. */
function nextMarkerAfter(
  markers: readonly NesLocationMarker[],
  position: NesCursorPosition
): NesLocationMarker | null {
  if (markers.length === 0) {
    return null
  }
  const after = markers.find((marker) => isAfterCursor(marker.edit, position))
  return after ?? markers[0]
}

function isAfterCursor(edit: NesEdit, position: NesCursorPosition): boolean {
  if (edit.range.endLine !== position.lineNumber) {
    return edit.range.endLine > position.lineNumber
  }
  return edit.range.endColumn > position.column
}
