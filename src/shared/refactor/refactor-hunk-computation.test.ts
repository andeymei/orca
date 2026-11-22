import { describe, expect, it } from 'vitest'
import { computeRefactorHunks } from './refactor-hunk-computation'

describe('computeRefactorHunks', () => {
  it('reports a pure insertion as one hunk that covers no original line', () => {
    const hunks = computeRefactorHunks('a\n', 'a\nb\n')
    expect(hunks).toHaveLength(1)
    expect(hunks[0].originalStartLine).toBe(2)
    expect(hunks[0].originalLineCount).toBe(0)
    expect(hunks[0].modifiedText).toBe('b\n')
  })

  it('merges a removal and the replacement that follows it into one hunk', () => {
    const hunks = computeRefactorHunks('a\n', 'b\n')
    expect(hunks).toHaveLength(1)
    expect(hunks[0].originalLineCount).toBe(1)
    expect(hunks[0].originalText).toBe('a\n')
    expect(hunks[0].modifiedText).toBe('b\n')
  })

  it('keeps two changes separated by an unchanged line in two hunks', () => {
    const hunks = computeRefactorHunks('a\nb\nc\n', 'A\nb\nC\n')
    expect(hunks).toHaveLength(2)
    expect(hunks.map((hunk) => hunk.originalStartLine)).toEqual([1, 3])
  })

  it('counts CRLF line endings as part of the line', () => {
    const hunks = computeRefactorHunks('a\r\nb\r\n', 'a\r\nB\r\n')
    expect(hunks).toHaveLength(1)
    expect(hunks[0].originalStartLine).toBe(2)
    expect(hunks[0].originalText).toBe('b\r\n')
  })

  it('reports no hunk for identical text', () => {
    expect(computeRefactorHunks('a\n', 'a\n')).toEqual([])
  })

  it('numbers the hunks h1, h2 when no prefix is given', () => {
    const hunks = computeRefactorHunks('a\nb\nc\n', 'A\nb\nC\n')
    expect(hunks.map((hunk) => hunk.id)).toEqual(['h1', 'h2'])
  })

  it('puts the prefix in front of the hunk number', () => {
    const hunks = computeRefactorHunks('a\n', 'b\n', 'src/a.ts:')
    expect(hunks.map((hunk) => hunk.id)).toEqual(['src/a.ts:h1'])
  })
})
