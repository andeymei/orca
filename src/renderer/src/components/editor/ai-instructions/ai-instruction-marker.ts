import { AI_INSTRUCTION_MARKER } from '../../../../../shared/ai-instruction-types'

// `@` is deliberately absent: stripping it would eat the marker itself.
const LEADING_DECORATION = /^[\s/*<>!#%;-]+/
const TRAILING_DELIMITER = /\s*(\*\/|-->)\s*$/

/** Reads the instruction body out of a comment token, or null when the comment carries no instruction. */
export function parseAiInstructionComment(commentText: string): string | null {
  const stripped = commentText
    .trimStart()
    .replace(LEADING_DECORATION, '')
    .replace(TRAILING_DELIMITER, '')

  if (!stripped.startsWith(AI_INSTRUCTION_MARKER)) {
    return null
  }

  const after = stripped.slice(AI_INSTRUCTION_MARKER.length)
  const separator = after[0]
  if (separator === undefined || (separator !== ':' && !/\s/.test(separator))) {
    return null
  }

  return after.replace(/^[:\s]+/, '').trim() || null
}
