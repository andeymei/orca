import { AI_INSTRUCTION_MARKER } from './ai-instruction-types'

const MARKER_COMMENT = `// ${AI_INSTRUCTION_MARKER}`

export function formatAiInstructionPrompt(args: {
  filePath: string
  lineNumber: number
  instruction: string
  contextStartLine: number
  contextEndLine: number
  contextExcerpt: string
}): string {
  return [
    `Implement the AI instruction at ${args.filePath}:${args.lineNumber}.`,
    '',
    `Instruction: ${args.instruction}`,
    '',
    `Context (${args.filePath}:${args.contextStartLine}-${args.contextEndLine}):`,
    args.contextExcerpt,
    '',
    `Keep the \`${MARKER_COMMENT}\` comment in place.`
  ].join('\n')
}

export function formatAiInstructionBatchPrompt(args: {
  filePath: string
  instructions: readonly { lineNumber: number; instruction: string }[]
}): string {
  const instructionLines = args.instructions.map(
    (entry, index) => `${index + 1}. Line ${entry.lineNumber}: ${entry.instruction}`
  )
  return [
    `Implement the following AI instructions in ${args.filePath}.`,
    '',
    ...instructionLines,
    '',
    `Keep every \`${MARKER_COMMENT}\` comment in place.`
  ].join('\n')
}
