// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NesEdit } from '../../../../../shared/code-completion/code-completion-types'
import { nesInlineCompletionForEdit } from './nes-inline-provider'
import { nesPlanStore } from './nes-plan-store'
import { useMonacoNextEditSuggestions } from './use-monaco-nes'

const { requestNesPlanMock, collectNesRelatedFilesMock } = vi.hoisted(() => ({
  requestNesPlanMock: vi.fn(),
  collectNesRelatedFilesMock: vi.fn()
}))

vi.mock('./nes-runtime-client', () => ({ requestNesPlan: requestNesPlanMock }))
vi.mock('./nes-related-files', () => ({ collectNesRelatedFiles: collectNesRelatedFilesMock }))

const FILE_PATH = '/repo/src/app.ts'
const MODEL_URI = 'vscode-remote://owner/repo/src/app.ts'
const CURSOR = { lineNumber: 1, column: 12 }

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
} {
  const cursorListeners: (() => void)[] = []
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this editor double only answers the calls the hook makes, and the model behind it is a real Monaco model.
  const editorInstance = {
    getModel: () => model,
    getPosition: () => CURSOR,
    setPosition: () => {},
    getOption: () => false,
    getAction: () => null,
    createDecorationsCollection: () => ({ set: () => {}, clear: () => {} }),
    onDidChangeModelContent: () => ({ dispose: () => {} }),
    onDidChangeCursorPosition: (listener: () => void) => {
      cursorListeners.push(listener)
      return { dispose: () => {} }
    }
  }
  return {
    editorInstance: editorInstance as unknown as monaco.editor.IStandaloneCodeEditor,
    moveCursor: () => {
      for (const listener of cursorListeners) {
        listener()
      }
    }
  }
}

function makeEdit(): NesEdit {
  return {
    id: 'edit-1',
    path: FILE_PATH,
    kind: 'replace',
    range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 12 },
    originalText: 'const a = 1',
    text: 'const a = 12',
    label: 'extend the constant'
  }
}

afterEach(() => {
  for (const model of models.splice(0)) {
    model.dispose()
  }
  nesPlanStore.clear()
  requestNesPlanMock.mockReset()
  collectNesRelatedFilesMock.mockReset()
})

describe('useMonacoNextEditSuggestions', () => {
  it('binds the model under the key the inline provider asks by', async () => {
    const model = createModel()
    requestNesPlanMock.mockResolvedValue({ edits: [makeEdit()] })
    collectNesRelatedFilesMock.mockResolvedValue([])
    const { editorInstance, moveCursor } = createFakeEditor(model)

    const view = renderHook(() =>
      useMonacoNextEditSuggestions({
        filePath: FILE_PATH,
        relativePath: 'src/app.ts',
        languageId: 'typescript',
        enabled: true,
        triggerDelayMs: 0,
        enabledExtensions: ['ts'],
        editorInstance,
        files: { target: { kind: 'local' }, worktreeId: null, worktreePath: null }
      })
    )

    act(() => {
      moveCursor()
    })

    await waitFor(() => {
      expect(nesPlanStore.getPlan(FILE_PATH)).not.toBeNull()
    })

    const edit = nesPlanStore.editAt(model.uri.toString(), CURSOR)
    expect(edit).not.toBeNull()
    expect(nesInlineCompletionForEdit(edit!, model)).not.toBeNull()
    view.unmount()
  })
})
