import type { editor, IPosition } from 'monaco-editor'

/** The budgets the model sees, in tokens. */
export const NES_PREFIX_TOKEN_BUDGET = 4000
export const NES_SUFFIX_TOKEN_BUDGET = 1000
export const NES_CHARS_PER_TOKEN = 4

export type NesContextInput = {
  prefix: string
  suffix: string
  filePath: string
  relativePath: string
  languageId: string
  /** The file line the shown prefix starts at, 1-based. */
  prefixStartLine: number
  /** The cursor's absolute position in the file, 1-based. */
  cursorLine: number
  cursorColumn: number
}

export function buildNesContext(
  model: editor.ITextModel,
  position: IPosition,
  options: { filePath: string; relativePath: string }
): NesContextInput {
  const lineCount = model.getLineCount()
  const cursorLine = Math.min(Math.max(position.lineNumber, 1), lineCount)
  const cursorColumn = Math.min(Math.max(position.column, 1), model.getLineMaxColumn(cursorLine))
  const prefixBudget = NES_PREFIX_TOKEN_BUDGET * NES_CHARS_PER_TOKEN
  const suffixBudget = NES_SUFFIX_TOKEN_BUDGET * NES_CHARS_PER_TOKEN
  const prefixStartLine = findPrefixStartLine(model, cursorLine, cursorColumn, prefixBudget)
  // Why: the prefix is cut at the cursor and nowhere else, so every line the model sees keeps its own columns.
  const prefix = model.getValueInRange({
    startLineNumber: prefixStartLine,
    startColumn: 1,
    endLineNumber: cursorLine,
    endColumn: cursorColumn
  })
  const suffix = trimNesTextAtLineBoundary(
    model.getValueInRange({
      startLineNumber: cursorLine,
      startColumn: cursorColumn,
      endLineNumber: lineCount,
      endColumn: model.getLineMaxColumn(lineCount)
    }),
    suffixBudget
  )
  return {
    prefix,
    suffix,
    filePath: options.filePath,
    relativePath: options.relativePath,
    languageId: model.getLanguageId(),
    prefixStartLine,
    cursorLine,
    cursorColumn
  }
}

/** The first whole line whose text up to the cursor still fits the budget. */
function findPrefixStartLine(
  model: editor.ITextModel,
  cursorLine: number,
  cursorColumn: number,
  budget: number
): number {
  let length = cursorColumn - 1
  let startLine = cursorLine
  while (startLine > 1) {
    const previousLineLength = model.getLineMaxColumn(startLine - 1) - 1
    if (length + previousLineLength + 1 > budget) {
      break
    }
    length += previousLineLength + 1
    startLine -= 1
  }
  return startLine
}

/**
 * The text the model sees, cut at a line boundary: a line shown in part invites an edit at the
 * fragment's end, and an insert carries no original text to catch the mistake. A text with no line
 * break inside the budget is cut at the budget; the fragment keeps the columns of the text it starts at.
 */
export function trimNesTextAtLineBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text
  }
  const head = text.slice(0, maxChars)
  const lastNewline = head.lastIndexOf('\n')
  return lastNewline === -1 ? head : head.slice(0, lastNewline)
}
