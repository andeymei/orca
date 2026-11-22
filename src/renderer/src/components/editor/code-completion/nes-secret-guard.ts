import type { editor } from 'monaco-editor'
import { findCodeCompletionSecretAround } from '../../../../../shared/code-completion/code-completion-secret-scan'

/**
 * How far past the sent text the scan looks.
 *
 * Why: a secret that begins outside the window and reaches into it — a token cut in half, a key
 * whose first line is above — would go out in part if only the sent text were checked.
 */
export const NES_SECRET_MARGIN_CHARS = 2000

/**
 * What kind of secret the text around the cursor holds, or null.
 *
 * Why the editor reads it and not the main process: the margin only exists in the file, and the
 * file is here. Reading a window of it costs nothing, while sending the margin would cost tokens
 * on every request.
 */
export function nesSecretNearCursor(input: {
  model: editor.ITextModel
  /** The cursor's line and column, 1-based. */
  cursorLine: number
  cursorColumn: number
  /** The first line of the text that is sent. */
  prefixStartLine: number
  /** The last line of the text that is sent. */
  suffixEndLine: number
  /** The file's name; a secret can sit in it too. */
  fileName: string
}): string | null {
  const before = textBefore(
    input.model,
    input.cursorLine,
    input.cursorColumn,
    input.prefixStartLine
  )
  const after = textAfter(input.model, input.cursorLine, input.cursorColumn, input.suffixEndLine)
  return findCodeCompletionSecretAround(before, after, input.fileName)
}

/** The text from the margin before the sent window up to the cursor. */
function textBefore(
  model: editor.ITextModel,
  cursorLine: number,
  cursorColumn: number,
  prefixStartLine: number
): string {
  const startLine = lineBefore(model, prefixStartLine, NES_SECRET_MARGIN_CHARS)
  return model.getValueInRange({
    startLineNumber: startLine,
    startColumn: 1,
    endLineNumber: cursorLine,
    endColumn: cursorColumn
  })
}

/** The text from the cursor to the margin past the sent window. */
function textAfter(
  model: editor.ITextModel,
  cursorLine: number,
  cursorColumn: number,
  suffixEndLine: number
): string {
  const endLine = lineAfter(model, suffixEndLine, NES_SECRET_MARGIN_CHARS)
  return model.getValueInRange({
    startLineNumber: cursorLine,
    startColumn: cursorColumn,
    endLineNumber: endLine,
    endColumn: model.getLineMaxColumn(endLine)
  })
}

/** The line that starts the margin before the given one. */
function lineBefore(model: editor.ITextModel, line: number, marginChars: number): number {
  let chars = 0
  let current = line
  while (current > 1 && chars < marginChars) {
    current -= 1
    chars += model.getLineMaxColumn(current)
  }
  return current
}

/** The line that ends the margin after the given one. */
function lineAfter(model: editor.ITextModel, line: number, marginChars: number): number {
  const lineCount = model.getLineCount()
  let chars = 0
  let current = line
  while (current < lineCount && chars < marginChars) {
    current += 1
    chars += model.getLineMaxColumn(current)
  }
  return current
}
