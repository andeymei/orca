// A `// @ai` instruction found in a source file, with the context handed to the agent.
export const AI_INSTRUCTION_MARKER = '@ai'
export type AiInstructionStatus = 'pending' | 'dispatched' | 'completed'
export type AiInstruction = {
  lineNumber: number
  instruction: string
  commentText: string
  contextExcerpt: string
  contextStartLine: number
  contextEndLine: number
}
