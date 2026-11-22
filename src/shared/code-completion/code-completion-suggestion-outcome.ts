/**
 * What became of a plan on the screen.
 *
 * The main process knows what the model answered; only the renderer knows whether the answer
 * reached the editor. The two halves meet here, so the trace can say whether a suggestion was
 * drawn and, when it was not, which rule held it back.
 */

/** Why the editor could not draw the edit that sits at the cursor. */
export type CodeCompletionDrawRefusal =
  /** The edit covers more than one line. */
  | 'multi_line_range'
  /** The edit carries no text. */
  | 'empty_text'
  /** The edit rewrites what it covers, and Monaco draws no ghost text for that. */
  | 'not_an_append'
  /** The buffer no longer holds the place the edit names. */
  | 'range_moved'
  /** The text under the edit is no longer the text the edit was made against. */
  | 'text_moved'

export type CodeCompletionSuggestionOutcome =
  | CodeCompletionDrawRefusal
  /** The plan carried no edit at all. */
  | 'no_edit'
  /** The plan carried edits, but none of them ends at the cursor. */
  | 'no_edit_at_cursor'
  /** The editor offered the suggestion to Monaco. */
  | 'shown'

export type CodeCompletionSuggestionReport = {
  /** What became of the plan. */
  readonly outcome: CodeCompletionSuggestionOutcome
  /** How many edits the plan carried. */
  readonly editCount: number
  /** The file the plan was for, relative to its workspace. */
  readonly file: string
}

/** The IPC channel both sides of the suggestion report use. */
export const CODE_COMPLETION_SUGGESTION_CHANNELS = {
  reportSuggestionOutcome: 'codeCompletion:reportSuggestionOutcome'
} as const
