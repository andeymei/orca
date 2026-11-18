import type { OnMount } from '@monaco-editor/react'
import type * as monaco from 'monaco-editor'
import {
  nesEditExtendsCoveredText,
  type NesEdit
} from '../../../../../shared/code-completion/code-completion-types'
import { nesPlanStore } from './nes-plan-store'

type MonacoApi = Parameters<OnMount>[1]

let provider: monaco.IDisposable | null = null
let providerMonaco: MonacoApi = null
let changeEmitter: monaco.Emitter<void> | null = null

export function ensureNesInlineCompletionsProvider(monaco: MonacoApi): void {
  // Re-register when Monaco is recreated; the old provider belongs to the previous instance.
  if (provider && providerMonaco === monaco) {
    return
  }
  provider?.dispose()
  providerMonaco = monaco
  const emitter = new monaco.Emitter<void>()
  changeEmitter = emitter

  provider = monaco.languages.registerInlineCompletionsProvider('*', {
    provideInlineCompletions(model, position) {
      const edit = nesPlanStore.editAt(model.uri.toString(), {
        lineNumber: position.lineNumber,
        column: position.column
      })
      if (!edit) {
        return null
      }
      const completion = nesInlineCompletionForEdit(edit, model)
      return completion ? { items: [completion] } : null
    },
    onDidChangeInlineCompletions: emitter.event,
    // Why: the interface has no optional member here — an omitted method is a type error.
    disposeInlineCompletions() {}
  })
}

/** Tells Monaco the answer changed, so it asks the provider again without the user moving. */
export function fireNesInlineCompletionsChanged(): void {
  changeEmitter?.fire()
}

export function nesInlineCompletionForEdit(
  edit: NesEdit,
  model: monaco.editor.ITextModel
): monaco.languages.InlineCompletion | null {
  // Why: Monaco renders a suggestion only when its range begins on the cursor's line, so a range
  // that spans lines can never be shown.
  if (edit.range.startLine !== edit.range.endLine) {
    return null
  }
  // Why: the classic ghost text renders an insertion only, so a rewrite would be an invisible suggestion.
  if (!nesEditExtendsCoveredText(edit)) {
    return null
  }
  const range = model.validateRange({
    startLineNumber: edit.range.startLine,
    startColumn: edit.range.startColumn,
    endLineNumber: edit.range.endLine,
    endColumn: edit.range.endColumn
  })
  // Why: a clamped range names a place the model no longer has, so the edit no longer applies to it.
  if (
    range.startLineNumber !== edit.range.startLine ||
    range.startColumn !== edit.range.startColumn ||
    range.endLineNumber !== edit.range.endLine ||
    range.endColumn !== edit.range.endColumn
  ) {
    return null
  }
  // Why: the model moved under the plan while the request was in flight, so the edit no longer fits it.
  if (model.getValueInRange(range) !== edit.originalText) {
    return null
  }
  return {
    insertText: edit.text,
    range: {
      startLineNumber: edit.range.startLine,
      startColumn: edit.range.startColumn,
      endLineNumber: edit.range.endLine,
      endColumn: edit.range.endColumn
    }
  }
}
