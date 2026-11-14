import type { editor } from 'monaco-editor'

const CONTEXT_WINDOW_LINES = 10

/** The line window handed to the agent around an instruction, clamped to the file. */
export function resolveAiInstructionContextRange(
  lineNumber: number,
  lineCount: number
): { startLine: number; endLine: number } {
  return {
    startLine: Math.max(1, lineNumber - CONTEXT_WINDOW_LINES),
    endLine: Math.min(lineCount, lineNumber + CONTEXT_WINDOW_LINES)
  }
}

/** The source text around an instruction, cut from the model. */
export function buildAiInstructionContext(
  model: editor.ITextModel,
  lineNumber: number
): { excerpt: string; startLine: number; endLine: number } {
  const { startLine, endLine } = resolveAiInstructionContextRange(lineNumber, model.getLineCount())
  const excerpt = model.getValueInRange({
    startLineNumber: startLine,
    startColumn: 1,
    endLineNumber: endLine,
    endColumn: model.getLineMaxColumn(endLine)
  })
  return { excerpt, startLine, endLine }
}
