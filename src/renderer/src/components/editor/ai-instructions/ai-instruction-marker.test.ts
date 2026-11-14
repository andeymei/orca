import { describe, expect, it } from 'vitest'
import { parseAiInstructionComment } from './ai-instruction-marker'

describe('parseAiInstructionComment', () => {
  it('reads the instruction from a line comment', () => {
    expect(parseAiInstructionComment('// @ai 指数退避重试，最多 5 次')).toBe(
      '指数退避重试，最多 5 次'
    )
  })

  it('reads the instruction from a hash comment', () => {
    expect(parseAiInstructionComment('# @ai 用 asyncio 改写')).toBe('用 asyncio 改写')
  })

  it('drops the closing delimiter of a block comment', () => {
    expect(parseAiInstructionComment('/* @ai 修一下 */')).toBe('修一下')
  })

  it('drops the closing delimiter of an html comment', () => {
    expect(parseAiInstructionComment('<!-- @ai 修一下 -->')).toBe('修一下')
  })

  it('ignores a marker that is not at the start of the comment', () => {
    expect(parseAiInstructionComment('// TODO: @ai 修一下')).toBeNull()
  })

  it('ignores a marker that is part of a longer word', () => {
    expect(parseAiInstructionComment('// @aider 修一下')).toBeNull()
  })

  it('ignores a marker with no instruction body', () => {
    expect(parseAiInstructionComment('// @ai')).toBeNull()
  })

  it('ignores a comment with no marker', () => {
    expect(parseAiInstructionComment('// 普通注释')).toBeNull()
  })
})
