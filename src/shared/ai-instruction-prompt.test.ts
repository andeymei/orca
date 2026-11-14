import { describe, expect, it } from 'vitest'
import { formatAiInstructionBatchPrompt, formatAiInstructionPrompt } from './ai-instruction-prompt'

describe('formatAiInstructionPrompt', () => {
  it('states the file, the line, the instruction and the context', () => {
    expect(
      formatAiInstructionPrompt({
        filePath: 'src/foo.ts',
        lineNumber: 42,
        instruction: '指数退避重试，最多 5 次',
        contextStartLine: 38,
        contextEndLine: 70,
        contextExcerpt: 'async function f() {}'
      })
    ).toBe(
      [
        'Implement the AI instruction at src/foo.ts:42.',
        '',
        'Instruction: 指数退避重试，最多 5 次',
        '',
        'Context (src/foo.ts:38-70):',
        'async function f() {}',
        '',
        'Keep the `// @ai` comment in place.'
      ].join('\n')
    )
  })
})

describe('formatAiInstructionBatchPrompt', () => {
  it('lists every instruction with its line', () => {
    expect(
      formatAiInstructionBatchPrompt({
        filePath: 'src/foo.ts',
        instructions: [
          { lineNumber: 42, instruction: '指数退避重试' },
          { lineNumber: 88, instruction: '提取成独立 schema' }
        ]
      })
    ).toBe(
      [
        'Implement the following AI instructions in src/foo.ts.',
        '',
        '1. Line 42: 指数退避重试',
        '2. Line 88: 提取成独立 schema',
        '',
        'Keep every `// @ai` comment in place.'
      ].join('\n')
    )
  })
})
