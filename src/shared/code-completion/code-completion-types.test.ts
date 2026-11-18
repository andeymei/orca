import { describe, expect, it } from 'vitest'
import {
  NES_MAX_EDITS,
  nesEditExtendsCoveredText,
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
    const paths = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts']
    const edits = paths.map((path, index) => buildEdit({ id: `e${index + 1}`, path }))

    const plan = validateNesEditPlan({ edits }, { allowedPaths: paths })

    expect(plan.edits).toHaveLength(NES_MAX_EDITS)
    expect(plan.edits.map((edit) => edit.id)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5'])
  })

  it('truncates to the first five edits before it drops the unusable ones', () => {
    const paths = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts']
    const edits = [
      buildEdit({ id: 'e1', path: paths[0] }),
      buildEdit({
        id: 'e2',
        path: paths[1],
        kind: 'delete',
        originalText: 'const answer = 42\n',
        text: 'new'
      }),
      buildEdit({ id: 'e3', path: paths[2] }),
      buildEdit({ id: 'e4', path: paths[3] }),
      buildEdit({ id: 'e5', path: paths[4] }),
      buildEdit({ id: 'e6', path: paths[5] })
    ]

    const plan = validateNesEditPlan({ edits }, { allowedPaths: paths })

    expect(plan.edits.map((edit) => edit.id)).toEqual(['e1', 'e3', 'e4', 'e5'])
  })

  it('keeps the first two edits of a file and drops the third', () => {
    const plan = validateNesEditPlan(
      { edits: [buildEdit({ id: 'e1' }), buildEdit({ id: 'e2' }), buildEdit({ id: 'e3' })] },
      { allowedPaths: [FILE_PATH] }
    )

    expect(plan.edits.map((edit) => edit.id)).toEqual(['e1', 'e2'])
  })

  it('keeps two edits for a file when the third is unusable', () => {
    const plan = validateNesEditPlan(
      {
        edits: [
          buildEdit({ id: 'e1' }),
          buildEdit({ id: 'e2' }),
          buildEdit({ id: 'e3', kind: 'delete', originalText: 'const answer = 42\n', text: 'new' })
        ]
      },
      { allowedPaths: [FILE_PATH] }
    )

    expect(plan.edits.map((edit) => edit.id)).toEqual(['e1', 'e2'])
  })

  it('does not let an unusable edit take a slot of the two allowed for its file', () => {
    const plan = validateNesEditPlan(
      {
        edits: [
          buildEdit({ id: 'e1' }),
          buildEdit({ id: 'e2', kind: 'delete', originalText: 'const answer = 42\n', text: 'new' }),
          buildEdit({ id: 'e3' })
        ]
      },
      { allowedPaths: [FILE_PATH] }
    )

    expect(plan.edits.map((edit) => edit.id)).toEqual(['e1', 'e3'])
  })

  it('keeps two edits in one file and one in another', () => {
    const plan = validateNesEditPlan(
      {
        edits: [
          buildEdit({ id: 'e1' }),
          buildEdit({ id: 'e2' }),
          buildEdit({ id: 'e3', path: 'src/other.ts' })
        ]
      },
      { allowedPaths: [FILE_PATH, 'src/other.ts'] }
    )

    expect(plan.edits.map((edit) => edit.id)).toEqual(['e1', 'e2', 'e3'])
  })

  it('keeps the edits around a structurally broken one', () => {
    const plan = validateNesEditPlan(
      {
        edits: [
          buildEdit({ id: 'e1' }),
          {
            id: 'e2',
            path: FILE_PATH,
            range: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 1 },
            originalText: '',
            text: 'const answer = 42\n',
            label: 'no kind'
          },
          buildEdit({ id: 'e3' })
        ]
      },
      { allowedPaths: [FILE_PATH] }
    )

    expect(plan.edits.map((edit) => edit.id)).toEqual(['e1', 'e3'])
  })

  it('returns an empty plan when the payload is not JSON', () => {
    const plan = validateNesEditPlan('not json at all', { allowedPaths: [FILE_PATH] })

    expect(plan).toEqual({ edits: [] })
  })
})

describe('nesEditExtendsCoveredText', () => {
  it('accepts an insert, whose covered text is empty', () => {
    expect(nesEditExtendsCoveredText(buildEdit())).toBe(true)
  })

  it('accepts a replace that only appends to the covered text', () => {
    const edit = buildEdit({
      kind: 'replace',
      originalText: 'const answer = 42',
      text: 'const answer = 42 and the question'
    })

    expect(nesEditExtendsCoveredText(edit)).toBe(true)
  })

  it('refuses a replace that rewrites the covered text', () => {
    const edit = buildEdit({
      kind: 'replace',
      originalText: 'const answer = 42',
      text: 'const question = 42'
    })

    expect(nesEditExtendsCoveredText(edit)).toBe(false)
  })

  it('refuses a replace that shortens the covered text', () => {
    const edit = buildEdit({
      kind: 'replace',
      originalText: 'const answer = 42',
      text: 'const answer'
    })

    expect(nesEditExtendsCoveredText(edit)).toBe(false)
  })

  it('refuses a delete', () => {
    const edit = buildEdit({
      kind: 'delete',
      originalText: 'const answer = 42',
      text: ''
    })

    expect(nesEditExtendsCoveredText(edit)).toBe(false)
  })

  it('refuses an edit that changes nothing', () => {
    const edit = buildEdit({
      kind: 'replace',
      originalText: 'const answer = 42',
      text: 'const answer = 42'
    })

    expect(nesEditExtendsCoveredText(edit)).toBe(false)
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

  it('returns null when a column is below one', () => {
    expect(sliceRange(text, { startLine: 1, startColumn: 0, endLine: 1, endColumn: 3 })).toBeNull()
    expect(sliceRange(text, { startLine: 1, startColumn: -2, endLine: 1, endColumn: 3 })).toBeNull()
    expect(sliceRange(text, { startLine: 1, startColumn: 1, endLine: 1, endColumn: 0 })).toBeNull()
    expect(sliceRange(text, { startLine: 1, startColumn: 1, endLine: 2, endColumn: 0 })).toBeNull()
  })

  it('counts columns in UTF-16 code units', () => {
    const withEmoji = 'const \u{1F600} = 1'

    expect(
      sliceRange(withEmoji, { startLine: 1, startColumn: 10, endLine: 1, endColumn: 11 })
    ).toBe('=')
  })
})
