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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readSuggestionReport(
  report: unknown
): { outcome: string; editCount: number; file: string } | null {
  if (!isRecord(report)) {
    return null
  }
  const outcome = report.outcome
  const file = report.file
  const editCount = report.editCount
  if (typeof outcome !== 'string' || typeof file !== 'string') {
    return null
  }
  return {
    outcome,
    editCount: typeof editCount === 'number' ? editCount : 0,
    file
  }
}
