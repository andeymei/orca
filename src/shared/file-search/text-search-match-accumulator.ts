import type { SearchFileResult, SearchMatch } from './code-search-types'
import type { SearchAccumulator } from './text-search'
import { isGeneratedSearchPath } from './search-file-classification'
import { sliceAtCodeUnitLimit } from '../text/surrogate-safe-text-slice'
import { ownRetainedString } from '../text/own-retained-string'

// Bound repeated context so dense search results fit within the SSH message limit.
export const MAX_LINE_CONTENT_LENGTH = 500
const TRUNCATION_MARKER = '…'

type ClampedLineContext = {
  lineContent: string
  column: number
  matchLength: number
  displayColumn?: number
  displayMatchLength?: number
}

function clampLineContext(
  text: string,
  matchStart: number,
  matchLength: number
): ClampedLineContext {
  if (text.length <= MAX_LINE_CONTENT_LENGTH) {
    return { lineContent: text, column: matchStart + 1, matchLength }
  }
  const clampedMatchLength = Math.min(matchLength, MAX_LINE_CONTENT_LENGTH)
  const remaining = MAX_LINE_CONTENT_LENGTH - clampedMatchLength
  const leftBudget = Math.floor(remaining / 2)
  let windowStart = Math.max(0, matchStart - leftBudget)
  let windowEnd = Math.min(text.length, windowStart + MAX_LINE_CONTENT_LENGTH)
  windowStart = Math.max(0, windowEnd - MAX_LINE_CONTENT_LENGTH)
  if (windowStart > 0 && (text.codePointAt(windowStart - 1) ?? 0) > 0xffff) {
    windowStart++
  }

  let snippet = sliceAtCodeUnitLimit(text.slice(windowStart), windowEnd - windowStart)
  windowEnd = windowStart + snippet.length
  const displayStart = Math.max(windowStart, Math.min(matchStart, windowEnd))
  const displayMatchLength = Math.max(
    0,
    Math.min(matchStart + matchLength, windowEnd) - displayStart
  )
  let column = displayStart - windowStart + 1
  if (windowStart > 0) {
    snippet = TRUNCATION_MARKER + snippet
    column += TRUNCATION_MARKER.length
  }
  if (windowEnd < text.length) {
    snippet += TRUNCATION_MARKER
  }
  return {
    // A tiny slice can otherwise retain the entire source line until results are released.
    lineContent: ownRetainedString(snippet),
    column: matchStart + 1,
    matchLength,
    displayColumn: column,
    displayMatchLength
  }
}

/**
 * Build output can outnumber authored matches many times over, so a shared budget lets generated files
 * exhaust every result slot before the source a user searched for is reached. Generated matches get their
 * own capped budget so authored files always keep room in the result set.
 */
const GENERATED_MATCH_BUDGET_RATIO = 0.25

export function generatedMatchBudget(maxResults: number): number {
  return Math.max(1, Math.floor(maxResults * GENERATED_MATCH_BUDGET_RATIO))
}

export function pushSearchMatch(args: {
  fileResult: SearchFileResult
  accumulator: SearchAccumulator
  lineContent: string
  matchStart: number
  matchLength: number
  lineNumber: number
  maxResults: number
}): 'continue' | 'stop' {
  const generated = isGeneratedSearchFile(args.accumulator, args.fileResult)
  if (generated && args.accumulator.generatedMatches >= generatedMatchBudget(args.maxResults)) {
    // Keep scanning: an authored match later in the stream still deserves a slot.
    return 'continue'
  }
  const clamped = clampLineContext(args.lineContent, args.matchStart, args.matchLength)
  const match: SearchMatch = {
    line: args.lineNumber,
    column: clamped.column,
    matchLength: clamped.matchLength,
    lineContent: clamped.lineContent
  }
  if (clamped.displayColumn !== undefined) {
    match.displayColumn = clamped.displayColumn
  }
  if (clamped.displayMatchLength !== undefined) {
    match.displayMatchLength = clamped.displayMatchLength
  }
  args.fileResult.matches.push(match)
  args.fileResult.matchCount = (args.fileResult.matchCount ?? 0) + 1
  args.accumulator.totalMatches++
  if (generated) {
    args.accumulator.generatedMatches++
  }
  if (args.accumulator.totalMatches >= args.maxResults) {
    args.accumulator.truncated = true
    return 'stop'
  }
  return 'continue'
}

/** Classify once per file; a dense match set would otherwise re-run the path regex for every match. */
function isGeneratedSearchFile(
  accumulator: SearchAccumulator,
  fileResult: SearchFileResult
): boolean {
  const cached = accumulator.generatedFiles.get(fileResult.filePath)
  if (cached !== undefined) {
    return cached
  }
  const generated = isGeneratedSearchPath(fileResult.relativePath)
  accumulator.generatedFiles.set(fileResult.filePath, generated)
  return generated
}
