import { describe, expect, it } from 'vitest'
import { AI_INSTRUCTION_MARKER } from '../../../../../shared/ai-instruction-types'
import { resolveAiInstructionStatuses } from './ai-instruction-status'

const instruction = (lineNumber: number, text: string) => ({
  lineNumber,
  instruction: text,
  commentText: `// ${AI_INSTRUCTION_MARKER} ${text}`,
  contextExcerpt: '',
  contextStartLine: lineNumber,
  contextEndLine: lineNumber
})

const record = (body: string, lineNumber: number, extra: Record<string, unknown> = {}) => ({
  id: `id-${body}-${lineNumber}`,
  worktreeId: 'w1',
  filePath: 'src/foo.ts',
  source: 'ai-instruction' as const,
  startLine: lineNumber,
  lineNumber,
  body,
  createdAt: 1,
  side: 'modified' as const,
  ...extra
})

describe('resolveAiInstructionStatuses', () => {
  it('marks an instruction with no record as pending', () => {
    expect(resolveAiInstructionStatuses([instruction(10, '甲')], [])[0].status).toBe('pending')
  })

  it('marks an instruction with a sent record as dispatched', () => {
    const resolved = resolveAiInstructionStatuses(
      [instruction(10, '甲')],
      [record('甲', 10, { sentAt: 2 })]
    )
    expect(resolved[0].status).toBe('dispatched')
  })

  it('marks an instruction with a completed record as completed', () => {
    const resolved = resolveAiInstructionStatuses(
      [instruction(10, '甲')],
      [record('甲', 10, { sentAt: 2, completedAt: 3 })]
    )
    expect(resolved[0].status).toBe('completed')
  })

  it('does not let one completed record complete a twin instruction elsewhere', () => {
    const resolved = resolveAiInstructionStatuses(
      [instruction(10, '甲'), instruction(90, '甲')],
      [record('甲', 10, { sentAt: 2, completedAt: 3 })]
    )
    expect(resolved.map((item) => item.status)).toEqual(['completed', 'pending'])
  })

  it('does not carry a completed state onto a rewritten instruction', () => {
    const resolved = resolveAiInstructionStatuses(
      [instruction(10, '甲改')],
      [record('甲', 10, { sentAt: 2, completedAt: 3 })]
    )
    expect(resolved[0].status).toBe('pending')
  })
})
