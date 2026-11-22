import type { RefactorHunk } from './refactor-types'

/** Splits the text into lines that keep their own terminator, so joining them back is lossless. */
function splitLines(text: string): string[] {
  const lines: string[] = []
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      lines.push(text.slice(start, index + 1))
      start = index + 1
    }
  }
  if (start < text.length) {
    lines.push(text.slice(start))
  }
  return lines
}

/** Replaces the lines each accepted hunk covers; the lines of a rejected hunk stay as they were. */
export function applyRefactorHunks(original: string, hunks: readonly RefactorHunk[]): string {
  const lines = splitLines(original)
  const ordered = [...hunks].sort((left, right) => right.originalStartLine - left.originalStartLine)
  for (const hunk of ordered) {
    lines.splice(hunk.originalStartLine - 1, hunk.originalLineCount, hunk.modifiedText)
  }
  return lines.join('')
}
