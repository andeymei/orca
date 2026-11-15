// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  collectAiInstructions,
  mayHaveUnscannedAiInstruction,
  toAiInstructionTokens
} from './ai-instruction-scan'

describe('collectAiInstructions', () => {
  it('finds an instruction in a line comment', () => {
    expect(
      collectAiInstructions([
        [{ text: 'const a = 1', type: 'identifier' }],
        [{ text: '// @ai 修一下', type: 'comment' }]
      ])
    ).toEqual([{ lineNumber: 2, instruction: '修一下', commentText: '// @ai 修一下' }])
  })

  it('ignores a marker inside a string literal', () => {
    expect(
      collectAiInstructions([[{ text: 'const s = "// @ai 修一下"', type: 'string' }]])
    ).toEqual([])
  })

  it('ignores a comment whose token type is not a comment', () => {
    expect(collectAiInstructions([[{ text: '// @ai 修一下', type: 'string' }]])).toEqual([])
  })

  it('accepts every comment token flavour', () => {
    expect(
      collectAiInstructions([
        [{ text: '/* @ai 甲 */', type: 'comment.block' }],
        [{ text: '<!-- @ai 乙 -->', type: 'comment' }]
      ]).map((item) => item.instruction)
    ).toEqual(['甲', '乙'])
  })

  it('cuts each token text out of its own line', () => {
    expect(
      toAiInstructionTokens(
        ['const a = 1 // @ai 甲', 'const b = 2'],
        [
          [
            { startColumn: 1, offset: 0, type: 'identifier' },
            { startColumn: 13, offset: 12, type: 'comment' }
          ],
          [{ startColumn: 1, offset: 0, type: 'identifier' }]
        ]
      )
    ).toEqual([
      [
        { text: 'const a = 1 ', type: 'identifier' },
        { text: '// @ai 甲', type: 'comment' }
      ],
      [{ text: 'const b = 2', type: 'identifier' }]
    ])
  })
})

describe('mayHaveUnscannedAiInstruction', () => {
  it('asks for a retry when the buffer has a marker but no instruction was found', () => {
    expect(mayHaveUnscannedAiInstruction('// @ai 甲', [])).toBe(true)
  })

  it('does not ask for a retry when the buffer has no marker', () => {
    expect(mayHaveUnscannedAiInstruction('const a = 1', [])).toBe(false)
  })

  it('does not ask for a retry when an instruction was found', () => {
    expect(
      mayHaveUnscannedAiInstruction('// @ai 甲', [
        {
          lineNumber: 1,
          instruction: '甲',
          commentText: '// @ai 甲',
          contextExcerpt: '// @ai 甲',
          contextStartLine: 1,
          contextEndLine: 1
        }
      ])
    ).toBe(false)
  })
})
