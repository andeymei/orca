// Counts the checkboxes in a task list or a plan file. A task list often quotes example
// checkboxes inside a fenced code block; those are samples, not work, so they must not be
// counted as progress.

/** How far a task list has got. */
export type CheckboxCount = { done: number; total: number; inProgress: number }

const CHECKBOX = /^\s*[-*]\s+\[([ xX~-])\]/
const FENCE = /^\s*(`{3,}|~{3,})/
const FENCE_END = /^\s*(`{3,}|~{3,})\s*$/

export function countCheckboxes(markdown: string): CheckboxCount {
  let done = 0
  let inProgress = 0
  let total = 0
  let fence: { char: string; length: number } | null = null

  for (const line of markdown.split('\n')) {
    if (fence !== null) {
      const end = FENCE_END.exec(line)
      if (end && end[1]!.charAt(0) === fence.char && end[1]!.length >= fence.length) {
        fence = null
      }
      continue
    }

    const marker = FENCE.exec(line)
    if (marker) {
      fence = { char: marker[1]!.charAt(0), length: marker[1]!.length }
      continue
    }

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
