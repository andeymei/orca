import { describe, expect, it } from 'vitest'
import { AI_INSTRUCTION_MARKER } from '../../../../../shared/ai-instruction-types'
import {
  isAiInstructionCompletedByStatus,
  resolveAiInstructionStatuses
} from './ai-instruction-status'

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

  it('carries the matched record id even while the instruction is still pending', () => {
    const resolved = resolveAiInstructionStatuses([instruction(10, '甲')], [record('甲', 10)])
    expect(resolved[0].status).toBe('pending')
    expect(resolved[0].recordId).toBe('id-甲-10')
  })
})

describe('isAiInstructionCompletedByStatus', () => {
  it('completes only on a done status that arrived after the dispatch', () => {
    expect(
      isAiInstructionCompletedByStatus({
        sentAt: 100,
        completedAt: undefined,
        status: { state: 'done', updatedAt: 150 }
      })
    ).toBe(true)
  })

  it('does not complete on a done status from before the dispatch', () => {
    expect(
      isAiInstructionCompletedByStatus({
        sentAt: 100,
        completedAt: undefined,
        status: { state: 'done', updatedAt: 50 }
      })
    ).toBe(false)
  })

  it('does not complete while the agent is waiting', () => {
    expect(
      isAiInstructionCompletedByStatus({
        sentAt: 100,
        completedAt: undefined,
        status: { state: 'waiting', updatedAt: 150 }
      })
    ).toBe(false)
  })

  it('does not complete on a done status whose evidence predates the dispatch', () => {
    expect(
      isAiInstructionCompletedByStatus({
        sentAt: 100,
        completedAt: undefined,
        status: { state: 'done', updatedAt: 150, evidenceObservedAt: 50 }
      })
    ).toBe(false)
  })

  it('does not complete a record that is already completed', () => {
    expect(
      isAiInstructionCompletedByStatus({
        sentAt: 100,
        completedAt: 120,
        status: { state: 'done', updatedAt: 150 }
      })
    ).toBe(false)
  })

  it('does not complete a record that was never dispatched', () => {
    expect(
      isAiInstructionCompletedByStatus({
        sentAt: undefined,
        completedAt: undefined,
        status: { state: 'done', updatedAt: 150 }
      })
    ).toBe(false)
  })

  it('does not complete without an agent status', () => {
    expect(
      isAiInstructionCompletedByStatus({
        sentAt: 100,
        completedAt: undefined,
        status: undefined
      })
    ).toBe(false)
  })
})
