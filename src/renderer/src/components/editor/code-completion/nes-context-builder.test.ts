// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { editor as monacoEditor } from 'monaco-editor/esm/vs/editor/editor.api.js'
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js'
import {
  buildNesContext,
  NES_CHARS_PER_TOKEN,
  NES_PREFIX_TOKEN_BUDGET,
  NES_SUFFIX_TOKEN_BUDGET
} from './nes-context-builder'

const OPTIONS = { filePath: '/repo/src/app.ts', relativePath: 'src/app.ts' }
const models: monacoEditor.ITextModel[] = []

function createModel(text: string, languageId = 'typescript'): monacoEditor.ITextModel {
  const model = monacoEditor.createModel(text, languageId)
  models.push(model)
  return model
}

afterEach(() => {
  for (const model of models.splice(0)) {
    model.dispose()
  }
})

describe('buildNesContext', () => {
  it('puts the cursor between the prefix and the suffix', () => {
    const model = createModel('const a = 1\nconst b = 2\nconst c = 3')

    const context = buildNesContext(model, { lineNumber: 2, column: 8 }, OPTIONS)

    expect(context.prefix).toBe('const a = 1\nconst b')
    expect(context.suffix).toBe(' = 2\nconst c = 3')
    expect(context.cursorLine).toBe(2)
    expect(context.cursorColumn).toBe(8)
    expect(context.prefixStartLine).toBe(1)
  })

  it('keeps the prefix within its budget and the suffix whole', () => {
    const line = 'const value = 1'
    const model = createModel(Array.from({ length: 4000 }, () => line).join('\n'))

    const context = buildNesContext(model, { lineNumber: 4000, column: line.length + 1 }, OPTIONS)

    expect(context.prefix.length).toBeLessThanOrEqual(NES_PREFIX_TOKEN_BUDGET * NES_CHARS_PER_TOKEN)
    expect(context.prefixStartLine).toBeGreaterThan(1)

    const shortModel = createModel('const a = 1\nconst b = 2')
    const shortContext = buildNesContext(shortModel, { lineNumber: 1, column: 1 }, OPTIONS)

    expect(shortContext.suffix).toBe('const a = 1\nconst b = 2')
    expect(shortContext.prefix).toBe('')
  })

  it('reads the file path and the language from the model', () => {
    const model = createModel('const a = 1', 'typescript')

    const context = buildNesContext(model, { lineNumber: 1, column: 1 }, OPTIONS)

    expect(context.filePath).toBe('/repo/src/app.ts')
    expect(context.relativePath).toBe('src/app.ts')
    expect(context.languageId).toBe('typescript')
  })

  it('starts the prefix at a line boundary', () => {
    const lines = Array.from({ length: 4000 }, (_, index) => `const value${index} = 1`)
    const model = createModel(lines.join('\n'))

    const context = buildNesContext(model, { lineNumber: 4000, column: 5 }, OPTIONS)

    expect(context.prefix.split('\n')[0]).toBe(`const value${context.prefixStartLine - 1} = 1`)
  })

  it('trims the suffix at a line boundary', () => {
    const tailLines = Array.from({ length: 400 }, (_, index) => `line${index} ${'y'.repeat(50)}`)
    const model = createModel(`start\n${tailLines.join('\n')}`)

    const context = buildNesContext(model, { lineNumber: 1, column: 3 }, OPTIONS)

    expect(tailLines).toContain(context.suffix.split('\n').at(-1))
    expect(context.suffix.length).toBeLessThanOrEqual(NES_SUFFIX_TOKEN_BUDGET * NES_CHARS_PER_TOKEN)
    expect(context.suffix.length).toBeLessThan(tailLines.join('\n').length)
  })

  it('never cuts the prefix except at the cursor', () => {
    const longLine = 'x'.repeat(NES_PREFIX_TOKEN_BUDGET * NES_CHARS_PER_TOKEN + 4000)
    const model = createModel(`${longLine}\nconst tail = 1`)

    const context = buildNesContext(model, { lineNumber: 1, column: longLine.length + 1 }, OPTIONS)

    expect(context.prefix).toBe(longLine)
    expect(context.prefixStartLine).toBe(1)
  })
})
