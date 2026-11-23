import type { editor } from 'monaco-editor'
import type { NesEdit } from '../../../../../shared/code-completion/code-completion-types'
import { applyNesEdit, previewNesEdit } from './nes-edit-application'
import { nesInlineCompletionForEdit } from './nes-inline-provider'
import { decideNesTabAction, type NesTabDecision } from './nes-key-routing'
import { nesNextLocationAfter } from './nes-other-locations'
import type { NesMetricTracker } from './nes-metric-tracker'

export type NesEditorActions = {
  /** What the Tab key does: accept the suggestion, jump to the next place, or nothing. */
  decide: () => NesTabDecision
  /** Takes the whole suggestion into the buffer. */
  accept: () => void
  /** Takes the next word of the suggestion, so a long answer is not all or nothing. */
  acceptWord: () => void
  /** Takes the next line of the suggestion. */
  acceptLine: () => void
  /** Moves the cursor to the place the edit starts. */
  jump: (location: NesEdit) => void
  /** Moves the cursor to the next place the plan predicts. */
  jumpToNextLocation: () => void
  /** Draws the change the plan proposes over the code, while the key is held. */
  preview: (active: boolean) => void
}

/**
 * What the person can do with the suggestion the editor holds.
 *
 * Why these live apart from the feature: they are the editor's verbs, and each one answers for
 * itself — what the Tab key does, what a part of the suggestion costs, where the jump goes.
 */
export function createNesEditorActions(input: {
  editorInstance: editor.IStandaloneCodeEditor
  /** The edit of the bound file whose range ends at the cursor. */
  editAtCursor: () => NesEdit | null
  /** The places the plan predicts somewhere other than the cursor. */
  locations: () => NesEdit[]
  /** Drops the plan and everything that came with it. */
  dropPlan: () => void
  /** Takes the preview widget away. */
  releasePreview: () => void
  /** Puts the preview widget up and keeps how to take it away. */
  showPreview: (release: () => void) => void
  tracker: NesMetricTracker
}): NesEditorActions {
  const decide = (): NesTabDecision => {
    const model = input.editorInstance.getModel()
    const edit = input.editAtCursor()
    // Why: the provider owns the rules of what it can draw, so it decides whether a suggestion shows.
    const hasInlineSuggestion =
      model !== null && edit !== null && nesInlineCompletionForEdit(edit, model) !== null
    return decideNesTabAction({
      hasInlineSuggestion,
      hasOtherLocations: input.locations().length > 0
    })
  }

  const accept = (): void => {
    const model = input.editorInstance.getModel()
    const edit = input.editAtCursor()
    if (!model || !edit) {
      return
    }
    // Why: the edit no longer matches this buffer, so keeping it would leave a marker that can
    // never land.
    if (!applyNesEdit(model, input.editorInstance, edit)) {
      input.dropPlan()
      return
    }
    // Why: the accepted edit is gone from the plan, and the next tick asks for a fresh one.
    input.dropPlan()
    // Why: Monaco's ghost text must not outlive the text we applied.
    void input.editorInstance.getAction('editor.action.inlineSuggest.hide')?.run()
    input.tracker.accepted(edit.text, {
      startLineNumber: edit.range.startLine,
      startColumn: edit.range.startColumn,
      endLineNumber: edit.range.endLine,
      endColumn: edit.range.endColumn
    })
  }

  // Why Monaco's own actions: they keep the rest of the suggestion after a part of it is
  // taken, so the answer does not have to be written out again here.
  const acceptWord = (): void => {
    void input.editorInstance.getAction('editor.action.inlineSuggest.acceptNextWord')?.run()
    input.tracker.partial()
  }

  const acceptLine = (): void => {
    void input.editorInstance.getAction('editor.action.inlineSuggest.acceptNextLine')?.run()
    input.tracker.partial()
  }

  const jump = (location: NesEdit): void => {
    // Why: the edit's range end is where the edit becomes the anchor, so the ghost text shows there.
    input.editorInstance.setPosition({
      lineNumber: location.range.endLine,
      column: location.range.endColumn
    })
  }

  const jumpToNextLocation = (): void => {
    const position = input.editorInstance.getPosition()
    const locations = input.locations()
    const next = position ? nesNextLocationAfter(locations, position) : null
    if (next) {
      jump(next)
    }
  }

  const preview = (active: boolean): void => {
    if (!active) {
      input.releasePreview()
      return
    }
    const model = input.editorInstance.getModel()
    const edit = input.editAtCursor()
    if (!model || !edit) {
      return
    }
    // Why: a fresh press replaces the widget an earlier one left behind.
    input.releasePreview()
    input.showPreview(previewNesEdit(model, input.editorInstance, edit))
  }

  return { decide, accept, acceptWord, acceptLine, jump, jumpToNextLocation, preview }
}
