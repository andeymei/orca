// The verification records a plan file carries: one line per round the verification agent ran.
// The parser reads the format and nothing else — whether a round really passed is what the agent
// wrote down, and the parser only reports it.

import { linesOutsideFences } from './markdown-fences'
import type { VerificationFacts } from './model'

/** The heading of the section the records live in. */
const SECTION_HEADING = /^##[ \t\u3000]+验证记录[ \t\u3000]*$/

/** A level-1 or level-2 heading: the section runs until the next one of these. */
const SECTION_END = /^#{1,2}[ \t\u3000]+/

/** The bullet a record line starts with. */
const BULLET = /^[-*][ \t]+/

/** The separator between the three fields of a record. */
const SEPARATOR = ' · '

/** The verdict of a round that passed. */
const PASSED = '通过'

/** The verdict of a round that failed. */
const FAILED = '未通过'

/** The shape of the date a record carries. */
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** How many days each month has, February aside. */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** Whether the year has a February 29th. */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** Whether the text is a date that exists: `2026-02-30` is not one. */
function isRealDate(text: string): boolean {
  if (!DATE.test(text)) {
    return false
  }
  const year = Number(text.slice(0, 4))
  const month = Number(text.slice(5, 7))
  const day = Number(text.slice(8, 10))
  if (month < 1 || month > 12) {
    return false
  }
  const lastDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1]!
  return day >= 1 && day <= lastDay
}

/** The verdict of one record line, or null when the line is not a record. */
function verdictOf(line: string): boolean | null {
  if (!BULLET.test(line)) {
    // The format is fixed: a record line carries its bullet, and a line without one is
    // something else in the section.
    return null
  }

  const fields = line.replace(BULLET, '').split(SEPARATOR)
  if (fields.length < 3) {
    return null
  }
  if (!isRealDate(fields[0]!.trim())) {
    return null
  }
  if (fields.slice(2).join(SEPARATOR).trim() === '') {
    return null
  }

  const verdict = fields[1]!.trim()
  // '未通过' holds '通过' inside it: the failure is asked about first, or every failure counts
  // as a pass and the card lies from then on.
  if (verdict === FAILED) {
    return false
  }
  if (verdict === PASSED) {
    return true
  }
  return null
}

/**
 * The records of the plan file, or null when it holds none.
 *
 * Only the '验证记录' section counts, and only the lines in the fixed format count as a round:
 * anything the parser does not recognise is no round at all, because a record that is counted
 * wrongly is worse than a record that is missed.
 */
export function parseVerificationRecords(markdown: string): VerificationFacts | null {
  let inSection = false
  let rounds = 0
  let passed = 0
  let lastPassed: boolean | null = null

  for (const raw of linesOutsideFences(markdown)) {
    // The plan file is read as it is on disk: a checkout on Windows keeps the carriage return of
    // every line, and the heading is end-anchored — a line that ends with one would never match.
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw

    if (!inSection) {
      inSection = SECTION_HEADING.test(line)
      continue
    }

    if (SECTION_END.test(line)) {
      inSection = false
      continue
    }

    const verdict = verdictOf(line)
    if (verdict === null) {
      continue
    }
    rounds += 1
    passed += verdict ? 1 : 0
    lastPassed = verdict
  }

  if (rounds === 0) {
    return null
  }
  return { rounds, passed, lastPassed }
}
