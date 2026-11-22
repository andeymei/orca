import { ipcMain } from 'electron'
import { CODE_COMPLETION_SUGGESTION_CHANNELS } from '../../shared/code-completion/code-completion-suggestion-outcome'
import {
  CODE_COMPLETION_METRIC_CHANNELS,
  type CodeCompletionMetricEvent
} from '../../shared/code-completion/code-completion-metrics'
import { recordCompletionMetric } from '../code-completion/completion-metrics'
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

  ipcMain.handle(CODE_COMPLETION_METRIC_CHANNELS.recordMetric, (_event, report: unknown) => {
    const metric = readMetricReport(report)
    if (!metric) {
      return
    }
    return recordCompletionMetric(metric)
  })
}

/** What became of a suggestion, as the renderer reported it. */
function readMetricReport(report: unknown): {
  event: CodeCompletionMetricEvent
  model: string
  latencyMs?: number
} | null {
  if (!isRecord(report)) {
    return null
  }
  const event = report.event
  const model = report.model
  if (!isCodeCompletionMetricEvent(event) || typeof model !== 'string') {
    return null
  }
  const latencyMs = report.latencyMs
  return {
    event,
    model,
    ...(typeof latencyMs === 'number' ? { latencyMs } : {})
  }
}

/** The events the metric file knows; anything else is not a metric. */
const CODE_COMPLETION_METRIC_EVENTS: readonly CodeCompletionMetricEvent[] = [
  'shown',
  'accepted',
  'partial',
  'kept',
  'undone',
  'stale'
]

function isCodeCompletionMetricEvent(value: unknown): value is CodeCompletionMetricEvent {
  return typeof value === 'string' && CODE_COMPLETION_METRIC_EVENTS.some((event) => event === value)
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
