import { diffLines } from 'diff'
import type { RefactorHunk } from './refactor-types'

type ChangeGroup = {
  originalStartLine: number
  modifiedStartLine: number
  originalText: string
  modifiedText: string
  originalLineCount: number
  modifiedLineCount: number
}

/** The trailing empty element left by the final newline is not a line of its own. */
function countLines(text: string): number {
  const lines = text.split('\n')
  return lines.at(-1) === '' ? lines.length - 1 : lines.length
}

function toRefactorHunk(group: ChangeGroup, id: string): RefactorHunk {
  return {
    id,
    originalStartLine: group.originalStartLine,
    originalLineCount: group.originalLineCount,
    modifiedStartLine: group.modifiedStartLine,
    modifiedLineCount: group.modifiedLineCount,
    originalText: group.originalText,
    modifiedText: group.modifiedText
  }
}

/** Splits the original and the modified text into the changed regions the review UI shows. */
export function computeRefactorHunks(original: string, modified: string): RefactorHunk[] {
  const hunks: RefactorHunk[] = []
  let originalLine = 1
  let modifiedLine = 1
  let group: ChangeGroup | undefined

  for (const part of diffLines(original, modified)) {
    const lineCount = countLines(part.value)
    if (!part.added && !part.removed) {
      if (group) {
        hunks.push(toRefactorHunk(group, `h${hunks.length + 1}`))
        group = undefined
      }
      originalLine += lineCount
      modifiedLine += lineCount
      continue
    }
    group ??= {
      originalStartLine: originalLine,
      modifiedStartLine: modifiedLine,
      originalText: '',
      modifiedText: '',
      originalLineCount: 0,
      modifiedLineCount: 0
    }
    if (part.removed) {
      group.originalText += part.value
      group.originalLineCount += lineCount
      originalLine += lineCount
    } else {
      group.modifiedText += part.value
      group.modifiedLineCount += lineCount
      modifiedLine += lineCount
    }
  }

  if (group) {
    hunks.push(toRefactorHunk(group, `h${hunks.length + 1}`))
  }
  return hunks
}
