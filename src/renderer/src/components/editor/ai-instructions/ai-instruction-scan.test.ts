// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { collectAiInstructions, toAiInstructionTokens } from './ai-instruction-scan'

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
