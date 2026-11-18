// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import type { NesEdit } from '../../../../../shared/code-completion/code-completion-types'
import { nesPlanStore } from './nes-plan-store'
import {
  ensureNesInlineCompletionsProvider,
  fireNesInlineCompletionsChanged,
  nesInlineCompletionForEdit
} from './nes-inline-provider'

const FILE_PATH = '/repo/src/app.ts'
const models: monaco.editor.ITextModel[] = []

function createModel(text: string): monaco.editor.ITextModel {
  const model = monaco.editor.createModel(text, 'typescript')
  models.push(model)
  return model
}

function makeEdit(overrides: Partial<NesEdit> = {}): NesEdit {
  return {
    id: 'edit-1',
    path: FILE_PATH,
    kind: 'replace',
    range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 12 },
    originalText: 'const a = 1',
    text: 'const a = 12',
    label: 'extend the constant',
    ...overrides
  }
}

afterEach(() => {
  for (const model of models.splice(0)) {
    model.dispose()
  }
  nesPlanStore.clear()
})

describe('nes inline completion', () => {
  it('turns an insert edit into an inline completion at the cursor', () => {
    const model = createModel('const a = 1')

    const completion = nesInlineCompletionForEdit(
      makeEdit({
        kind: 'insert',
        range: { startLine: 1, startColumn: 12, endLine: 1, endColumn: 12 },
        originalText: '',
        text: 'const b = 2'
      }),
      model
    )

    expect(completion).toEqual({
      insertText: 'const b = 2',
      range: { startLineNumber: 1, startColumn: 12, endLineNumber: 1, endColumn: 12 }
    })
  })

  it('turns a multi-line insert into one inline completion', () => {
    const model = createModel('const a = 1')

    const completion = nesInlineCompletionForEdit(
      makeEdit({
        kind: 'insert',
        range: { startLine: 1, startColumn: 12, endLine: 1, endColumn: 12 },
        originalText: '',
        text: 'const b = 2\nconst c = 3'
      }),
      model
    )

    expect(completion?.insertText).toBe('const b = 2\nconst c = 3')
    expect(completion?.range).toEqual({
      startLineNumber: 1,
      startColumn: 12,
      endLineNumber: 1,
      endColumn: 12
    })
  })

  it('turns a replace that extends the covered text into an inline completion', () => {
    const model = createModel('const a = 1')

    const completion = nesInlineCompletionForEdit(makeEdit(), model)

    expect(completion).toEqual({
      insertText: 'const a = 12',
      range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 12 }
    })
  })

  it('returns null for a replace that rewrites the covered text', () => {
    const model = createModel('const a = 1')

    expect(nesInlineCompletionForEdit(makeEdit({ text: 'const a = 2' }), model)).toBeNull()
  })

  it('returns null for a delete edit', () => {
    const model = createModel('const a = 1')

    expect(nesInlineCompletionForEdit(makeEdit({ kind: 'delete', text: '' }), model)).toBeNull()
  })

  it('rejects an edit whose range no longer matches the model', () => {
    const model = createModel('const a = 1')

    expect(
      nesInlineCompletionForEdit(
        makeEdit({ originalText: 'const b = 1', text: 'const b = 12' }),
        model
      )
    ).toBeNull()
  })

  it('returns null for a replace edit that starts on an earlier line', () => {
    const model = createModel('const a = 1\nconst b = 2')

    expect(
      nesInlineCompletionForEdit(
        makeEdit({
          range: { startLine: 1, startColumn: 1, endLine: 2, endColumn: 12 },
          originalText: 'const a = 1\nconst b = 2',
          text: 'const a = 1\nconst b = 22'
        }),
        model
      )
    ).toBeNull()
  })

  it('returns null instead of throwing when the range names a line past the end of the file', () => {
    const model = createModel('const a = 1\nconst b = 2')

    const replaced = nesInlineCompletionForEdit(
      makeEdit({
        range: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 12 },
        originalText: 'const c = 3',
        text: 'const c = 33'
      }),
      model
    )
    const inserted = nesInlineCompletionForEdit(
      makeEdit({
        kind: 'insert',
        range: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 1 },
        originalText: '',
        text: 'const c = 3'
      }),
      model
    )

    expect(replaced).toBeNull()
    expect(inserted).toBeNull()
  })
})

const INLINE_CONTEXT: monaco.languages.InlineCompletionContext = {
  triggerKind: monaco.languages.InlineCompletionTriggerKind.Automatic,
  selectedSuggestionInfo: undefined,
  includeInlineEdits: false,
  includeInlineCompletions: true,
  requestIssuedDateTime: 0,
  earliestShownDateTime: 0
}

let registeredProvider: monaco.languages.InlineCompletionsProvider | null = null

beforeAll(() => {
  const spy = vi.spyOn(monaco.languages, 'registerInlineCompletionsProvider')
  ensureNesInlineCompletionsProvider(monaco)
  registeredProvider = spy.mock.calls[0]?.[1] ?? null
  spy.mockRestore()
})

function provideAt(
  model: monaco.editor.ITextModel,
  lineNumber: number,
  column: number
): Promise<monaco.languages.InlineCompletions | null> {
  const tokenSource = new monaco.CancellationTokenSource()
  return Promise.resolve(
    registeredProvider?.provideInlineCompletions(
      model,
      new monaco.Position(lineNumber, column),
      INLINE_CONTEXT,
      tokenSource.token
    )
  ).then((completions) => completions ?? null)
}

describe('nes inline completion provider', () => {
  it('offers the plan edit of the model the cursor sits in', async () => {
    const model = createModel('const a = 1')
    nesPlanStore.bindModel(model.uri.toString(), FILE_PATH)
    nesPlanStore.setPlan(FILE_PATH, { edits: [makeEdit()] })

    const completions = await provideAt(model, 1, 12)

    expect(completions?.items).toEqual([
      {
        insertText: 'const a = 12',
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 12 }
      }
    ])
  })

  it('offers nothing when the cursor is not at the end of an edit', async () => {
    const model = createModel('const a = 1')
    nesPlanStore.bindModel(model.uri.toString(), FILE_PATH)
    nesPlanStore.setPlan(FILE_PATH, { edits: [makeEdit()] })

    expect(await provideAt(model, 1, 6)).toBeNull()
  })

  it('tells Monaco to ask again when the plan changes', () => {
    let fired = 0
    const subscription = registeredProvider?.onDidChangeInlineCompletions?.(() => {
      fired += 1
    })

    fireNesInlineCompletionsChanged()

    expect(fired).toBe(1)
    subscription?.dispose()
  })
})
