// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { editor as monacoEditor } from 'monaco-editor/esm/vs/editor/editor.api.js'
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js'
import { nesSecretNearCursor } from './nes-secret-guard'

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

describe('the secret near the cursor', () => {
  it('finds a secret that sits in the text being sent', () => {
    const model = createModel(
      'const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"\nconst a = 1'
    )

    const secret = nesSecretNearCursor({
      model,
      cursorLine: 2,
      cursorColumn: 1,
      prefixStartLine: 1,
      suffixEndLine: 2,
      fileName: 'src/app.ts'
    })

    expect(secret).toBe('GitHub token')
  })

  it('finds a secret that sits above the text being sent', () => {
    const secret = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
    // The secret is 50 lines above the cursor: outside the window, inside the margin.
    const filler = Array.from({ length: 50 }, () => 'const value = 1').join('\n')
    const model = createModel(`${secret}\n${filler}\nconst a = 1`)

    const found = nesSecretNearCursor({
      model,
      cursorLine: 52,
      cursorColumn: 1,
      prefixStartLine: 52,
      suffixEndLine: 52,
      fileName: 'src/app.ts'
    })

    expect(found).toBe('GitHub token')
  })

  it('leaves a secret that is far above the text being sent', () => {
    const secret = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
    // 300 lines is more than the margin reaches, and the secret is not being sent either.
    const filler = Array.from({ length: 300 }, () => 'const value = 1').join('\n')
    const model = createModel(`${secret}\n${filler}\nconst a = 1`)

    const found = nesSecretNearCursor({
      model,
      cursorLine: 302,
      cursorColumn: 1,
      prefixStartLine: 302,
      suffixEndLine: 302,
      fileName: 'src/app.ts'
    })

    expect(found).toBeNull()
  })

  it('finds nothing in ordinary code', () => {
    const model = createModel('const add = (a: number, b: number) => a + b\nconst c = add(1, 2)')

    const secret = nesSecretNearCursor({
      model,
      cursorLine: 2,
      cursorColumn: 1,
      prefixStartLine: 1,
      suffixEndLine: 2,
      fileName: 'src/app.ts'
    })

    expect(secret).toBeNull()
  })
})
