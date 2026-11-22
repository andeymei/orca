// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { editor as monacoEditor } from 'monaco-editor/esm/vs/editor/editor.api.js'
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js'
import { nesRenameEdit, nesRenamedWord, nesRenameOccurrences } from './nes-rename-carry-over'

const models: monacoEditor.ITextModel[] = []

function createModel(text: string): monacoEditor.ITextModel {
  const model = monacoEditor.createModel(text, 'typescript')
  models.push(model)
  return model
}

afterEach(() => {
  for (const model of models.splice(0)) {
    model.dispose()
  }
})

describe('the renamed word', () => {
  it('reads the name that was replaced', () => {
    expect(nesRenamedWord('const foo = 1', 'const bar = 1')).toEqual({ from: 'foo', to: 'bar' })
  })

  it('reads the name that a longer name was typed over', () => {
    expect(nesRenamedWord('const foo = 1', 'const foobar = 1')).toEqual({
      from: 'foo',
      to: 'foobar'
    })
  })

  it('leaves a name that is too short alone', () => {
    expect(nesRenamedWord('const a = 1', 'const b = 1')).toBeNull()
  })

  it('leaves a change that is not a name alone', () => {
    expect(nesRenamedWord('const foo = 1', 'const foo = 42')).toBeNull()
  })

  it('leaves a line that did not change alone', () => {
    expect(nesRenamedWord('const foo = 1', 'const foo = 1')).toBeNull()
  })
})

describe('the places a rename is carried over to', () => {
  it('finds the whole name and not a part of a longer one', () => {
    const model = createModel(['const foo = 1', 'foo.bar()', 'const foobar = 2'].join('\n'))

    const occurrences = nesRenameOccurrences(model, 'foo', 1)

    expect(occurrences).toHaveLength(2)
    expect(occurrences[0]).toEqual({ line: 1, column: 7, endColumn: 10 })
    expect(occurrences[1]).toEqual({ line: 2, column: 1, endColumn: 4 })
  })

  it('finds only the places after the given line', () => {
    const model = createModel(['const foo = 1', 'foo.bar()'].join('\n'))

    expect(nesRenameOccurrences(model, 'foo', 2)).toHaveLength(1)
  })

  it('writes the edit that carries the name over', () => {
    const model = createModel(['const foo = 1', 'foo.bar()'].join('\n'))
    const occurrence = nesRenameOccurrences(model, 'foo', 2)[0]

    const edit = nesRenameEdit(model, { from: 'foo', to: 'bar' }, occurrence, '/repo/src/app.ts')

    expect(edit).toEqual({
      id: 'rename-2-1',
      path: '/repo/src/app.ts',
      kind: 'replace',
      range: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 4 },
      originalText: 'foo',
      text: 'bar',
      label: 'Rename foo to bar'
    })
  })
})
