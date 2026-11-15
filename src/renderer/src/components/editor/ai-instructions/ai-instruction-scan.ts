import * as monaco from 'monaco-editor'
import type { AiInstruction } from '../../../../../shared/ai-instruction-types'
import { AI_INSTRUCTION_MARKER } from '../../../../../shared/ai-instruction-types'
import { buildAiInstructionContext } from './ai-instruction-context'
import { parseAiInstructionComment } from './ai-instruction-marker'

export type AiInstructionToken = { text: string; type: string }

// Monaco names comment tokens `comment`, `comment.ts`, `comment.block` and so on.
const COMMENT_TOKEN_PREFIX = 'comment'

/** Finds the `@ai` instructions in already-tokenized lines. */
export function collectAiInstructions(
  lineTokens: readonly (readonly AiInstructionToken[])[]
): { lineNumber: number; instruction: string; commentText: string }[] {
  const found: { lineNumber: number; instruction: string; commentText: string }[] = []
  for (const [lineIndex, tokens] of lineTokens.entries()) {
    for (const token of tokens) {
      if (!token.type.startsWith(COMMENT_TOKEN_PREFIX)) {
        continue
      }
      const instruction = parseAiInstructionComment(token.text)
      if (instruction === null) {
        continue
      }
      found.push({ lineNumber: lineIndex + 1, instruction, commentText: token.text.trim() })
    }
  }
  return found
}

/** Cuts the token text out of each line, because Monaco's tokens carry no text of their own. */
export function toAiInstructionTokens(
  lines: readonly string[],
  tokenized: readonly (readonly { startColumn: number; offset: number; type: string }[])[]
): AiInstructionToken[][] {
  return tokenized.map((tokens, lineIndex) => {
    const line = lines[lineIndex] ?? ''
    return tokens.map((token, tokenIndex) => {
      const next = tokens[tokenIndex + 1]
      const start = token.startColumn - 1
      const end = next ? next.startColumn - 1 : line.length
      return { text: line.slice(start, end), type: token.type }
    })
  })
}

/** Finds every `@ai` instruction in a model, with the source context around each one. */
export function scanAiInstructions(model: monaco.editor.ITextModel): AiInstruction[] {
  const text = model.getValue()
  if (!text.includes(AI_INSTRUCTION_MARKER)) {
    return []
  }
  // Monaco splits lines on `\r\n`, `\r` and `\n`; the excerpt must use the same split.
  const lines = text.split(/\r\n|\r|\n/)
  const tokenized = monaco.editor.tokenize(text, model.getLanguageId())
  // Monaco's public token carries only a line-relative offset, so the 1-based column follows from it.
  const positioned = tokenized.map((tokens) =>
    tokens.map((token) => ({
      startColumn: token.offset + 1,
      offset: token.offset,
      type: token.type
    }))
  )
  return collectAiInstructions(toAiInstructionTokens(lines, positioned)).map((found) => {
    const context = buildAiInstructionContext(model, found.lineNumber)
    return {
      lineNumber: found.lineNumber,
      instruction: found.instruction,
      commentText: found.commentText,
      contextExcerpt: context.excerpt,
      contextStartLine: context.startLine,
      contextEndLine: context.endLine
    }
  })
}

/** True when the buffer holds a marker the scan found no instruction for — the language grammar may not have loaded yet. */
export function mayHaveUnscannedAiInstruction(
  text: string,
  instructions: readonly AiInstruction[]
): boolean {
  return instructions.length === 0 && text.includes(AI_INSTRUCTION_MARKER)
}
