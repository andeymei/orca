import { NES_CURSOR_MARKER } from '../../shared/code-completion/code-completion-prompt'

/**
 * Markup a gateway's own instructions drew out of the model instead of code.
 *
 * Why: a route that injects prompts of its own makes the model answer with tool calls, and shown
 * as a suggestion that markup would be gray text in the person's file. It is never code, so it is
 * never shown.
 */
const TOOL_MARKUP = /<\/?(?:tool_call|function|parameter)\b/

/** A model that wraps its answer in a fence; the first block is the answer and the rest is talk. */
const FENCED_BLOCK = /^\s*```[^\n]*\n([\s\S]*?)\n?```[\s\S]*$/

/** How many lines of the prefix an echoed answer may repeat. */
const ECHO_MAX_LINES = 5

/** A shorter tail is left alone: it may be a coincidence rather than an echo. */
const ECHO_MIN_CHARS = 3

/** How far into the suffix an overlap is looked for. */
const OVERLAP_PROBE_CHARS = 30

/** A shorter probe is left alone: a closing bracket may be legitimate. */
const OVERLAP_MIN_PROBE_CHARS = 8

/** Whether the answer is tool markup rather than code. */
export function looksLikeToolMarkup(answer: string): boolean {
  return TOOL_MARKUP.test(answer)
}

/**
 * The text to insert, taken from what the model answered.
 *
 * Why so much work on the answer: a model that repeats the code before the cursor, or the code
 * after it, or wraps its answer in a fence, produces gray text that repeats the file. The answer
 * is still the model's, but the parts that say what the file already says are dropped.
 */
export function cleanInlineSuggestion(
  raw: string,
  context: { prefix: string; suffix: string }
): string {
  const fenced = FENCED_BLOCK.exec(raw)
  let suggestion = fenced ? fenced[1] : raw
  // Why: a model that echoes the marker back has written it into the code it proposes.
  suggestion = suggestion.split(NES_CURSOR_MARKER).join('')
  suggestion = trimPrefixEcho(suggestion, context.prefix)
  suggestion = trimSuffixOverlap(suggestion, context.suffix)
  // Why: trailing whitespace would show as an empty line of ghost text and insert one when taken.
  return suggestion.replace(/\s+$/, '')
}

/**
 * Cuts the part of the answer that repeats the text before the cursor.
 *
 * Why: the suggestion is inserted at the cursor, so an echoed tail would be written twice. The
 * longest tail of the prefix the answer begins with is the echo.
 */
function trimPrefixEcho(suggestion: string, prefix: string): string {
  const lines = prefix.split('\n')
  for (let count = Math.min(lines.length, ECHO_MAX_LINES); count >= 1; count -= 1) {
    const tail = lines.slice(-count).join('\n')
    if (tail.trim().length >= ECHO_MIN_CHARS && suggestion.startsWith(tail)) {
      return suggestion.slice(tail.length)
    }
  }
  return suggestion
}

/**
 * Cuts the part of the answer that repeats the text after the cursor.
 *
 * Why: the model often continues with the code that already follows, and that code is in the
 * file already. A same-line tail such as a closing bracket is left alone, since it may be the
 * end of the statement the model is writing.
 */
function trimSuffixOverlap(suggestion: string, suffix: string): string {
  const probe = suffix.trimStart().slice(0, OVERLAP_PROBE_CHARS)
  if (probe.length >= OVERLAP_MIN_PROBE_CHARS) {
    const at = suggestion.indexOf(probe)
    if (at > 0) {
      return suggestion.slice(0, at).trimEnd()
    }
  }
  for (let length = Math.min(suffix.length, suggestion.length); length >= 2; length -= 1) {
    const head = suffix.slice(0, length)
    if (head.startsWith('\n') && suggestion.endsWith(head)) {
      return suggestion.slice(0, suggestion.length - length)
    }
  }
  return suggestion
}
