import type { OnMount } from '@monaco-editor/react'
import type * as monaco from 'monaco-editor'
import {
  nesEditExtendsCoveredText,
  type NesEdit
} from '../../../../../shared/code-completion/code-completion-types'
import type { CodeCompletionDrawRefusal } from '../../../../../shared/code-completion/code-completion-suggestion-outcome'
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
    // Why: Monaco declares disposeInlineCompletions without a `?`, and this repo's Monaco API type
    // is `any`, so nothing would catch its absence — it has to be written by hand.
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
  return nesInlineCompletionOutcome(edit, model).completion
}

/**
 * The completion the editor can draw, and the rule that held it back when it cannot.
 *
 * The reason is what tells the user whether the model had nothing to propose or the editor
 * could not use what it proposed, and the trace is the only place that difference is visible.
 */
export function nesInlineCompletionOutcome(
  edit: NesEdit,
  model: monaco.editor.ITextModel
): {
  completion: monaco.languages.InlineCompletion | null
  refusal: CodeCompletionDrawRefusal | null
} {
  // Why: Monaco renders a suggestion only when its range begins on the cursor's line, so a range
  // that spans lines can never be shown.
  if (edit.range.startLine !== edit.range.endLine) {
    return { completion: null, refusal: 'multi_line_range' }
  }
  // Why: an edit with no text has nothing to show, and accepting it would only remove the text.
  if (edit.text.length === 0) {
    return { completion: null, refusal: 'empty_text' }
  }
  // Why: Monaco draws a suggestion only when the difference between the covered text and the new
  // text holds no deletion, so an edit that rewrites what it covers is never drawn — the editor
  // would offer it and the user would see nothing. Only an edit that adds to the covered text can
  // be shown, and only that one is offered here.
  if (!nesEditExtendsCoveredText(edit)) {
    return { completion: null, refusal: 'not_an_append' }
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
    return { completion: null, refusal: 'range_moved' }
  }
  // Why: the model moved under the plan while the request was in flight, so the edit no longer fits it.
  if (model.getValueInRange(range) !== edit.originalText) {
    return { completion: null, refusal: 'text_moved' }
  }
  return {
    completion: {
      insertText: edit.text,
      range: {
        startLineNumber: edit.range.startLine,
        startColumn: edit.range.startColumn,
        endLineNumber: edit.range.endLine,
        endColumn: edit.range.endColumn
      }
    },
    refusal: null
  }
}
