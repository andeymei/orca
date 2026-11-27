// The lines of a markdown file that are in no fenced code block.
//
// A file that shows its own syntax puts the examples into a code block, and an example is not a
// fact: a plan file that shows what a verification record looks like must not have that example
// counted as a round.

const FENCE = /^\s*(`{3,}|~{3,})/
const FENCE_END = /^\s*(`{3,}|~{3,})\s*$/

/** The lines of the file that are in no fenced code block. */
export function linesOutsideFences(markdown: string): string[] {
  const lines: string[] = []
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

    lines.push(line)
  }

  return lines
}
