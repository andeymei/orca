import { describe, expect, it } from 'vitest'
import { computeRefactorHunks } from './refactor-hunk-computation'
import { applyRefactorHunks } from './refactor-hunk-application'

describe('applyRefactorHunks', () => {
  it('applies only the accepted hunk', () => {
    const original = 'a\nb\nc\n'
    const hunks = computeRefactorHunks(original, 'A\nb\nC\n')
    expect(applyRefactorHunks(original, [hunks[0]])).toBe('A\nb\nc\n')
  })

  it('reproduces the modified text when every hunk is applied', () => {
    const original = 'a\nb\nc\n'
    const modified = 'A\nb\nC\n'
    const hunks = computeRefactorHunks(original, modified)
    expect(applyRefactorHunks(original, hunks)).toBe(modified)
  })

  it('keeps the later hunk correct when an earlier one is applied too', () => {
    const original = 'a\nb\nc\nd\n'
    const modified = 'A\nb\nC\nd\n'
    const hunks = computeRefactorHunks(original, modified)
    expect(applyRefactorHunks(original, hunks)).toBe(modified)
  })
})
