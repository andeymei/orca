import type { editor } from 'monaco-editor'
import type { NesEditPlan } from '../../../../../shared/code-completion/code-completion-types'
import type { CodeCompletionSuggestionOutcome } from '../../../../../shared/code-completion/code-completion-suggestion-outcome'
import { nesInlineCompletionOutcome } from './nes-inline-provider'
import { nesPlanStore } from './nes-plan-store'

/**
 * What a plan became on the screen.
 *
 * The main process knows what the model answered and the renderer knows what the editor could
 * draw; this is where the two meet, and it is the only place that can say "the model proposed it
 * and the editor drew it" as opposed to either half alone.
 */
export function nesSuggestionOutcome(params: {
  plan: NesEditPlan | null
  model: editor.ITextModel
  /** The key the plan store binds the model under. */
  modelKey: string
  position: { lineNumber: number; column: number }
}): { outcome: CodeCompletionSuggestionOutcome; editCount: number } {
  const editCount = params.plan?.edits.length ?? 0
  if (editCount === 0) {
    return { outcome: 'no_edit', editCount }
  }
  const edit = nesPlanStore.editAt(params.modelKey, params.position)
  if (!edit) {
    return { outcome: 'no_edit_at_cursor', editCount }
  }
  const { completion, refusal } = nesInlineCompletionOutcome(edit, params.model)
  return { outcome: completion ? 'shown' : (refusal ?? 'not_an_append'), editCount }
}

/**
 * Tells the main process what became of the plan.
 *
 * The trace otherwise stops at the request, and a suggestion that never reached the screen looks
 * exactly like one that was never asked for.
 */
export function reportNesSuggestionOutcome(params: {
  outcome: CodeCompletionSuggestionOutcome
  editCount: number
  file: string
}): void {
  void window.api?.codeCompletion
    ?.reportSuggestionOutcome({
      outcome: params.outcome,
      editCount: params.editCount,
      file: params.file
    })
    .catch(() => {
      // Why: the report is a diagnostic, so a failure to record it must not disturb the editor.
    })
}
