// Counts the checkboxes in a task list or a plan file. A task list often quotes example
// checkboxes inside a fenced code block; those are samples, not work, so they must not be
// counted as progress.

import { linesOutsideFences } from './markdown-fences'

/** How far a task list has got. */
export type CheckboxCount = { done: number; total: number; inProgress: number }

const CHECKBOX = /^\s*[-*]\s+\[([ xX~-])\]/

export function countCheckboxes(markdown: string): CheckboxCount {
  let done = 0
  let inProgress = 0
  let total = 0

  for (const line of linesOutsideFences(markdown)) {
    const box = CHECKBOX.exec(line)
    if (!box) {
      continue
    }
    total += 1
    const mark = box[1]!
    if (mark === 'x' || mark === 'X') {
      done += 1
    } else if (mark === '~' || mark === '-') {
      inProgress += 1
    }
  }

  return { done, total, inProgress }
}
