import { ipcMain } from 'electron'
import { CODE_COMPLETION_SUGGESTION_CHANNELS } from '../../shared/code-completion/code-completion-suggestion-outcome'
import { startSpan } from '../observability/tracer'

/**
 * Records what became of a plan on the screen.
 *
 * The plan request is traced in the main process, but only the renderer knows whether the answer
 * became a suggestion the user could see. Without this the trace stops at the request, and a
 * feature that "does nothing" cannot be told from one that answers and is then thrown away.
 */
export function registerCodeCompletionSuggestionHandlers(): void {
  ipcMain.handle(
    CODE_COMPLETION_SUGGESTION_CHANNELS.reportSuggestionOutcome,
    (_event, report: unknown) => {
      const outcome = readSuggestionReport(report)
      if (!outcome) {
        return
      }
      const span = startSpan('codeCompletion.suggestion', {
        attributes: {
          file: outcome.file,
          outcome: outcome.outcome,
          edit_count: outcome.editCount
        }
      })
      span.end()
    }
  )
}

function readSuggestionReport(
  report: unknown
): { outcome: string; editCount: number; file: string } | null {
  if (typeof report !== 'object' || report === null) {
    return null
  }
  const record = report as Record<string, unknown>
  if (typeof record.outcome !== 'string' || typeof record.file !== 'string') {
    return null
  }
  return {
    outcome: record.outcome,
    editCount: typeof record.editCount === 'number' ? record.editCount : 0,
    file: record.file
  }
}
