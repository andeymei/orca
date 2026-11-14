import { describe, expect, it } from 'vitest'
import { resolveAiInstructionContextRange } from './ai-instruction-context'

describe('resolveAiInstructionContextRange', () => {
  it('takes a window around the line', () => {
    expect(resolveAiInstructionContextRange(42, 100)).toEqual({ startLine: 32, endLine: 52 })
  })

  it('never starts before the first line', () => {
    expect(resolveAiInstructionContextRange(3, 100)).toEqual({ startLine: 1, endLine: 13 })
  })

  it('never ends after the last line', () => {
    expect(resolveAiInstructionContextRange(99, 100)).toEqual({ startLine: 89, endLine: 100 })
  })
})
