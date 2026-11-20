// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { NesEdit } from '../../../../../shared/code-completion/code-completion-types'
import { ensureNesInlineCompletionsProvider } from './nes-inline-provider'
import { nesPlanStore } from './nes-plan-store'
import { nesShortcutHandlersFor, useMonacoNextEditSuggestions } from './use-monaco-nes'

const { requestNesPlanMock, collectNesRelatedFilesMock } = vi.hoisted(() => ({
  requestNesPlanMock: vi.fn(),
  collectNesRelatedFilesMock: vi.fn()
}))

vi.mock('./nes-runtime-client', () => ({ requestNesPlan: requestNesPlanMock }))
vi.mock('./nes-related-files', () => ({ collectNesRelatedFiles: collectNesRelatedFilesMock }))

const FILE_PATH = '/repo/src/app.ts'
const MODEL_URI = 'vscode-remote://owner/repo/src/app.ts'
const CURSOR = { lineNumber: 1, column: 12 }
const HIDE_ACTION = 'editor.action.inlineSuggest.hide'

const models: monaco.editor.ITextModel[] = []

function createModel(): monaco.editor.ITextModel {
  const model = monaco.editor.createModel('const a = 1', 'typescript', monaco.Uri.parse(MODEL_URI))
  models.push(model)
  return model
}

/** The editor half of the test; the model is the real one, so its URI and text are real. */
function createFakeEditor(model: monaco.editor.ITextModel): {
  editorInstance: monaco.editor.IStandaloneCodeEditor
  moveCursor: () => void
  hiddenActions: string[]
} {
  const cursorListeners: (() => void)[] = []
  const hiddenActions: string[] = []
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this editor double only answers the calls the hook makes, and the model behind it is a real Monaco model.
  const editorInstance = {
    getModel: () => model,
    getPosition: () => CURSOR,
    setPosition: () => {},
    getOption: () => false,
    pushUndoStop: () => true,
    getAction: (id: string) => ({
      run: () => {
        hiddenActions.push(id)
        return Promise.resolve()
      }
    }),
    createDecorationsCollection: () => ({ set: () => {}, clear: () => {} }),
    onDidChangeModelContent: () => ({ dispose: () => {} }),
    onDidChangeCursorPosition: (listener: () => void) => {
      cursorListeners.push(listener)
      return { dispose: () => {} }
    }
  }
  return {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a test double stands in for Monaco's editor; it implements only the members this hook calls.
    editorInstance: editorInstance as unknown as monaco.editor.IStandaloneCodeEditor,
    moveCursor: () => {
      for (const listener of cursorListeners) {
        listener()
      }
    },
    hiddenActions
  }
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

function renderHookFor(model: monaco.editor.ITextModel): {
  editorInstance: monaco.editor.IStandaloneCodeEditor
  moveCursor: () => void
  hiddenActions: string[]
  unmount: () => void
} {
  const { editorInstance, moveCursor, hiddenActions } = createFakeEditor(model)
  const view = renderHook(() =>
    useMonacoNextEditSuggestions({
      filePath: FILE_PATH,
      relativePath: 'src/app.ts',
      enabled: true,
      triggerDelayMs: 0,
      enabledExtensions: ['ts'],
      editorInstance,
      files: { target: { kind: 'local' }, worktreeId: null, worktreePath: null }
    })
  )
  return { editorInstance, moveCursor, hiddenActions, unmount: view.unmount }
}

afterEach(() => {
  for (const model of models.splice(0)) {
    model.dispose()
  }
  nesPlanStore.clear()
  requestNesPlanMock.mockReset()
  collectNesRelatedFilesMock.mockReset()
})

let registeredProvider: monaco.languages.InlineCompletionsProvider | null = null

beforeAll(() => {
  const spy = vi.spyOn(monaco.languages, 'registerInlineCompletionsProvider')
  ensureNesInlineCompletionsProvider(monaco)
  registeredProvider = spy.mock.calls[0]?.[1] ?? null
  spy.mockRestore()
})

const INLINE_CONTEXT: monaco.languages.InlineCompletionContext = {
  triggerKind: monaco.languages.InlineCompletionTriggerKind.Automatic,
  selectedSuggestionInfo: undefined,
  includeInlineEdits: false,
  includeInlineCompletions: true,
  requestIssuedDateTime: 0,
  earliestShownDateTime: 0
}

/** What the editor itself would ask the provider for the suggestion. */
async function provideAt(
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

describe('useMonacoNextEditSuggestions', () => {
  it('asks for a plan when the file opens', async () => {
    const model = createModel()
    requestNesPlanMock.mockResolvedValue({ edits: [makeEdit()] })
    collectNesRelatedFilesMock.mockResolvedValue([])

    const { unmount } = renderHookFor(model)

    await waitFor(() => {
      expect(requestNesPlanMock).toHaveBeenCalled()
    })
    // Why: the context builder reads the language off the model, which is the authoritative one.
    // The model here carries no language contribution, so it reads as plaintext.
    expect(requestNesPlanMock.mock.calls[0][0].languageId).toBe('plaintext')
    unmount()
  })

  it('records a failed tick instead of leaving an unhandled rejection', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const model = createModel()
    collectNesRelatedFilesMock.mockRejectedValue(new Error('the collector is down'))
    requestNesPlanMock.mockResolvedValue(null)

    const { unmount } = renderHookFor(model)

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        '[code-completion] The plan tick failed.',
        expect.any(Error)
      )
    })
    errorSpy.mockRestore()
    unmount()
  })

  it('asks again when the cursor moves', async () => {
    const model = createModel()
    requestNesPlanMock.mockResolvedValue({ edits: [makeEdit()] })
    collectNesRelatedFilesMock.mockResolvedValue([])

    const { moveCursor, unmount } = renderHookFor(model)

    await waitFor(() => {
      expect(requestNesPlanMock).toHaveBeenCalledTimes(1)
    })

    act(() => {
      moveCursor()
    })

    await waitFor(() => {
      expect(requestNesPlanMock).toHaveBeenCalledTimes(2)
    })
    unmount()
  })

  it('binds the model under the key the inline provider asks by', async () => {
    const model = createModel()
    requestNesPlanMock.mockResolvedValue({ edits: [makeEdit()] })
    collectNesRelatedFilesMock.mockResolvedValue([])

    const { unmount } = renderHookFor(model)

    await waitFor(() => {
      expect(nesPlanStore.getPlan(FILE_PATH)).not.toBeNull()
    })

    const completions = await provideAt(model, CURSOR.lineNumber, CURSOR.column)

    expect(completions?.items).toHaveLength(1)
    expect(completions?.items[0].insertText).toBe('const a = 12')
    unmount()
  })

  it('writes the accepted edit and only then hides the ghost text', async () => {
    const model = createModel()
    requestNesPlanMock.mockResolvedValue({ edits: [makeEdit()] })
    collectNesRelatedFilesMock.mockResolvedValue([])

    const { editorInstance, hiddenActions, unmount } = renderHookFor(model)
    await waitFor(() => {
      expect(nesPlanStore.getPlan(FILE_PATH)).not.toBeNull()
    })

    nesShortcutHandlersFor(editorInstance)?.accept()

    expect(model.getValue()).toBe('const a = 12')
    expect(hiddenActions).toEqual([HIDE_ACTION])
    unmount()
  })

  it('keeps the ghost text when the edit no longer fits the model', async () => {
    const model = createModel()
    requestNesPlanMock.mockResolvedValue({
      edits: [makeEdit({ originalText: 'const b = 1', text: 'const b = 12' })]
    })
    collectNesRelatedFilesMock.mockResolvedValue([])

    const { editorInstance, hiddenActions, unmount } = renderHookFor(model)
    await waitFor(() => {
      expect(nesPlanStore.getPlan(FILE_PATH)).not.toBeNull()
    })

    nesShortcutHandlersFor(editorInstance)?.accept()

    expect(model.getValue()).toBe('const a = 1')
    expect(hiddenActions).toEqual([])
    unmount()
  })

  it('drops the previous plan when the request fails', async () => {
    const model = createModel()
    requestNesPlanMock.mockResolvedValue({ edits: [makeEdit()] })
    collectNesRelatedFilesMock.mockResolvedValue([])

    const { moveCursor, unmount } = renderHookFor(model)
    await waitFor(() => {
      expect(nesPlanStore.getPlan(FILE_PATH)).not.toBeNull()
    })

    requestNesPlanMock.mockResolvedValue(null)
    act(() => {
      moveCursor()
    })

    await waitFor(() => {
      expect(nesPlanStore.getPlan(FILE_PATH)).toBeNull()
    })
    unmount()
  })
})
