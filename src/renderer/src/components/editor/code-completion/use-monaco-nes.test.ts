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

function createModel(text = 'const a = 1'): monaco.editor.ITextModel {
  const model = monaco.editor.createModel(text, 'typescript', monaco.Uri.parse(MODEL_URI))
  models.push(model)
  return model
}

type FakeNesEditor = {
  editorInstance: monaco.editor.IStandaloneCodeEditor
  moveCursor: () => void
  hiddenActions: string[]
  pressEscape: () => void
  clickGutter: (lineNumber: number) => void
  markerCounts: () => number[]
}

/** The editor half of the test; the model is the real one, so its URI and text are real. */
function createFakeEditor(model: monaco.editor.ITextModel): FakeNesEditor {
  const cursorListeners: (() => void)[] = []
  const keyListeners: ((event: monaco.IKeyboardEvent) => void)[] = []
  const mouseListeners: ((event: monaco.editor.IEditorMouseEvent) => void)[] = []
  const hiddenActions: string[] = []
  const markerCounts: number[] = []
  let position = { ...CURSOR }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this editor double only answers the calls the hook makes, and the model behind it is a real Monaco model.
  const editorInstance = {
    getModel: () => model,
    getPosition: () => position,
    setPosition: (next: monaco.IPosition) => {
      position = { lineNumber: next.lineNumber, column: next.column }
    },
    getOption: () => false,
    pushUndoStop: () => true,
    getAction: (id: string) => ({
      run: () => {
        hiddenActions.push(id)
        return Promise.resolve()
      }
    }),
    createDecorationsCollection: () => ({
      set: (decorations: monaco.editor.IModelDeltaDecoration[]) => {
        markerCounts.push(decorations.length)
      },
      clear: () => {}
    }),
    onDidChangeModelContent: () => ({ dispose: () => {} }),
    onDidChangeCursorPosition: (listener: () => void) => {
      cursorListeners.push(listener)
      return { dispose: () => {} }
    },
    onKeyDown: (listener: (event: monaco.IKeyboardEvent) => void) => {
      keyListeners.push(listener)
      return { dispose: () => {} }
    },
    onMouseDown: (listener: (event: monaco.editor.IEditorMouseEvent) => void) => {
      mouseListeners.push(listener)
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
    hiddenActions,
    pressEscape: () => {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hook reads the key code only, so the double carries that one field.
      const event = { keyCode: monaco.KeyCode.Escape } as monaco.IKeyboardEvent
      for (const listener of keyListeners) {
        listener(event)
      }
    },
    clickGutter: (lineNumber: number) => {
      const mouseEvent = {
        target: {
          type: monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN,
          position: { lineNumber, column: 1 }
        },
        event: { leftButton: true }
      }
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hook reads the target type, the button and the line only, so the double carries those three fields.
      const event = mouseEvent as unknown as monaco.editor.IEditorMouseEvent
      for (const listener of mouseListeners) {
        listener(event)
      }
    },
    markerCounts: () => markerCounts
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

function renderHookFor(model: monaco.editor.ITextModel): FakeNesEditor & { unmount: () => void } {
  const fakeEditor = createFakeEditor(model)
  const view = renderHook(() =>
    useMonacoNextEditSuggestions({
      filePath: FILE_PATH,
      relativePath: 'src/app.ts',
      enabled: true,
      triggerDelayMs: 0,
      enabledExtensions: ['ts'],
      editorInstance: fakeEditor.editorInstance,
      files: { target: { kind: 'local' }, worktreeId: null, worktreePath: null }
    })
  )
  return { ...fakeEditor, unmount: view.unmount }
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
    const failure = new Error('the collector is down')
    failure.name = 'CollectorFailure'
    collectNesRelatedFilesMock.mockRejectedValue(failure)
    requestNesPlanMock.mockResolvedValue(null)

    const { unmount } = renderHookFor(model)

    await waitFor(() => {
      // Why: the message can carry a path, so only the name reaches the log.
      expect(errorSpy).toHaveBeenCalledWith(
        '[code-completion] The plan tick failed.',
        'CollectorFailure'
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

  it('drops the accepted edit so a second Tab cannot write it twice', async () => {
    const model = createModel()
    requestNesPlanMock.mockResolvedValue({ edits: [makeEdit()] })
    collectNesRelatedFilesMock.mockResolvedValue([])

    const { editorInstance, unmount } = renderHookFor(model)
    await waitFor(() => {
      expect(nesPlanStore.getPlan(FILE_PATH)).not.toBeNull()
    })

    nesShortcutHandlersFor(editorInstance)?.accept()

    // Why: the cursor still stands at the insertion point, where the provider would draw it again.
    expect(model.getValue()).toBe('const a = 12')
    expect(nesPlanStore.getPlan(FILE_PATH)).toBeNull()
    expect(nesShortcutHandlersFor(editorInstance)?.decide()).toBe('pass-through')

    nesShortcutHandlersFor(editorInstance)?.accept()
    expect(model.getValue()).toBe('const a = 12')
    unmount()
  })

  it('rejects the suggestion on Escape, so the next Tab cannot write it', async () => {
    const model = createModel()
    requestNesPlanMock.mockResolvedValue({ edits: [makeEdit()] })
    collectNesRelatedFilesMock.mockResolvedValue([])

    const { editorInstance, pressEscape, hiddenActions, unmount } = renderHookFor(model)
    await waitFor(() => {
      expect(nesPlanStore.getPlan(FILE_PATH)).not.toBeNull()
    })
    expect(nesShortcutHandlersFor(editorInstance)?.decide()).toBe('accept-suggestion')

    act(() => {
      pressEscape()
    })

    expect(nesShortcutHandlersFor(editorInstance)?.decide()).toBe('pass-through')
    // Why: a Tab after the Esc must not write the edit the user just rejected.
    nesShortcutHandlersFor(editorInstance)?.accept()
    expect(model.getValue()).toBe('const a = 1')
    expect(hiddenActions).toEqual([])
    unmount()
  })

  it('keeps the plan when Escape lands with no suggestion at the cursor', async () => {
    const model = createModel('const a = 1\nconst b = 1')
    requestNesPlanMock.mockResolvedValue({
      edits: [
        makeEdit({
          range: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 12 },
          originalText: 'const b = 1',
          text: 'const b = 12'
        })
      ]
    })
    collectNesRelatedFilesMock.mockResolvedValue([])

    const { editorInstance, pressEscape, unmount } = renderHookFor(model)
    await waitFor(() => {
      expect(nesPlanStore.getPlan(FILE_PATH)).not.toBeNull()
    })
    // Why: the cursor sits on line 1, so the line-2 edit is a marker and not a suggestion.
    expect(nesShortcutHandlersFor(editorInstance)?.decide()).toBe('jump-to-next-location')

    act(() => {
      pressEscape()
    })

    expect(nesPlanStore.getPlan(FILE_PATH)).not.toBeNull()
    unmount()
  })

  it('drops the plan when the edit no longer matches the buffer', async () => {
    const model = createModel()
    // Why: the rewrite cannot be drawn as a ghost, so the plan shows it as a gutter marker.
    requestNesPlanMock.mockResolvedValue({
      edits: [makeEdit({ originalText: 'const b = 1', text: 'const b = 99' })]
    })
    collectNesRelatedFilesMock.mockResolvedValue([])

    const { editorInstance, hiddenActions, markerCounts, unmount } = renderHookFor(model)
    await waitFor(() => {
      expect(markerCounts().at(-1)).toBe(1)
    })

    nesShortcutHandlersFor(editorInstance)?.accept()

    expect(model.getValue()).toBe('const a = 1')
    expect(hiddenActions).toEqual([])
    // Why: a marker that can never land would keep offering the refused edit.
    expect(nesPlanStore.getPlan(FILE_PATH)).toBeNull()
    expect(markerCounts().at(-1)).toBe(0)
    unmount()
  })

  it('jumps to the marker whose gutter glyph was clicked', async () => {
    const model = createModel('const a = 1\nconst b = 1')
    requestNesPlanMock.mockResolvedValue({
      edits: [
        makeEdit({
          range: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 12 },
          originalText: 'const b = 1',
          text: 'const b = 12'
        })
      ]
    })
    collectNesRelatedFilesMock.mockResolvedValue([])

    const { editorInstance, clickGutter, markerCounts, unmount } = renderHookFor(model)
    await waitFor(() => {
      expect(markerCounts().at(-1)).toBe(1)
    })

    act(() => {
      clickGutter(3)
    })
    expect(editorInstance.getPosition()).toEqual(CURSOR)

    act(() => {
      clickGutter(2)
    })
    // Why: the marker's edit becomes the anchor at its range end, which is where the jump goes.
    expect(editorInstance.getPosition()).toEqual({ lineNumber: 2, column: 12 })
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
