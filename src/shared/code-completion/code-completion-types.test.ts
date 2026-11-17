import { describe, expect, it } from 'vitest'
import {
  NES_MAX_EDITS,
  sliceRange,
  validateNesEditPlan,
  type NesEdit
} from './code-completion-types'

const FILE_PATH = 'src/foo.ts'

function buildEdit(overrides: Partial<NesEdit> = {}): NesEdit {
  return {
    id: 'e1',
    path: FILE_PATH,
    kind: 'insert',
    range: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 1 },
    originalText: '',
    text: 'const answer = 42\n',
    label: 'add the answer',
    ...overrides
  }
}

describe('validateNesEditPlan', () => {
  it('keeps a well-formed insert', () => {
    const plan = validateNesEditPlan(
      {
        edits: [
          {
            id: 'e1',
            path: 'src/foo.ts',
            kind: 'insert',
            range: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 1 },
            originalText: '',
            text: 'const answer = 42\n',
            label: 'add the answer'
          }
        ]
      },
      { allowedPaths: ['src/foo.ts'] }
    )

    expect(plan.edits).toEqual([
      {
        id: 'e1',
        path: 'src/foo.ts',
        kind: 'insert',
        range: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 1 },
        originalText: '',
        text: 'const answer = 42\n',
        label: 'add the answer'
      }
    ])
  })

  it('drops an edit whose path is not in the context', () => {
    const plan = validateNesEditPlan(
      { edits: [buildEdit({ path: 'src/other.ts' })] },
      { allowedPaths: [FILE_PATH] }
    )

    expect(plan.edits).toEqual([])
  })

  it('drops a delete that carries new text', () => {
    const plan = validateNesEditPlan(
      { edits: [buildEdit({ kind: 'delete', originalText: 'const answer = 42\n', text: 'new' })] },
      { allowedPaths: [FILE_PATH] }
    )

    expect(plan.edits).toEqual([])
  })

  it('drops an insert that carries original text', () => {
    const plan = validateNesEditPlan(
      { edits: [buildEdit({ kind: 'insert', originalText: 'const answer = 42\n' })] },
      { allowedPaths: [FILE_PATH] }
    )

    expect(plan.edits).toEqual([])
  })

  it('drops a replace that carries neither text', () => {
    const plan = validateNesEditPlan(
      { edits: [buildEdit({ kind: 'replace', originalText: '', text: '' })] },
      { allowedPaths: [FILE_PATH] }
    )

    expect(plan.edits).toEqual([])
  })

  it('truncates a plan with more than five edits', () => {
    const edits = Array.from({ length: NES_MAX_EDITS + 1 }, (_unused, index) =>
      buildEdit({ id: `e${index + 1}` })
    )

    const plan = validateNesEditPlan({ edits }, { allowedPaths: [FILE_PATH] })

    expect(plan.edits.map((edit) => edit.id)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5'])
  })

  it('returns an empty plan when the payload is not JSON', () => {
    const plan = validateNesEditPlan('not json at all', { allowedPaths: [FILE_PATH] })

    expect(plan).toEqual({ edits: [] })
  })
})

describe('sliceRange', () => {
  const text = 'const a = 1\nconst b = 2\nconst c = 3'

  it('returns the text a range covers on one line', () => {
    expect(sliceRange(text, { startLine: 2, startColumn: 7, endLine: 2, endColumn: 8 })).toBe('b')
  })

  it('returns the text a range covers across lines', () => {
    expect(sliceRange(text, { startLine: 1, startColumn: 11, endLine: 2, endColumn: 7 })).toBe(
      '1\nconst '
    )
  })

  it('returns an empty string for the empty range at the cursor', () => {
    expect(sliceRange(text, { startLine: 2, startColumn: 12, endLine: 2, endColumn: 12 })).toBe('')
  })

  it('returns null when the range is out of bounds', () => {
    expect(sliceRange(text, { startLine: 4, startColumn: 1, endLine: 4, endColumn: 1 })).toBeNull()
    expect(sliceRange(text, { startLine: 1, startColumn: 1, endLine: 1, endColumn: 99 })).toBeNull()
  })

  it('counts columns in UTF-16 code units', () => {
    const withEmoji = 'const \u{1F600} = 1'

    expect(
      sliceRange(withEmoji, { startLine: 1, startColumn: 10, endLine: 1, endColumn: 11 })
    ).toBe('=')
  })
})
