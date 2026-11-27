// The rules the agents read, and the record line they spell out: the helpers the tests use to
// read a rule's own line the way the parser does.
//
// The rules and the parser are one format (see `verification-records`), so a rule that drifted
// from the parser would be a round the board never counts — with no error anywhere.

import { PASSED, SEPARATOR } from './verification-records'

/** The placeholders a rule's record line may carry, and the values that fill them. */
const FILLED: readonly (readonly [RegExp, string])[] = [
  [/<YYYY-MM-DD>/g, '2026-11-27'],
  [/<结论>/g, PASSED],
  [/<跑了什么>/g, 'pnpm tc']
]

/** A rule's own record line, with its placeholders filled in. */
export function filledRecordLine(line: string): string {
  return FILLED.reduce((text, [pattern, value]) => text.replaceAll(pattern, value), line)
}

/** The record lines a rule shows, in backticks: the ones shaped like a record. */
export function recordLinesOf(rule: string): string[] {
  return [...rule.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1]!)
    .filter((chunk) => chunk.startsWith('- ') && chunk.includes(SEPARATOR))
}
