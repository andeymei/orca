import type { editor, IRange } from 'monaco-editor'
import type {
  CodeCompletionMetricEvent,
  CodeCompletionMetricReport
} from '../../../../../shared/code-completion/code-completion-metrics'

/**
 * How long a suggestion has to stay on screen before it counts as kept.
 *
 * Why thirty seconds: long enough that the person went on with their work without touching it,
 * short enough that the number says something about the suggestion rather than about the session.
 */
export const NES_KEPT_AFTER_MS = 30_000

export type NesMetricTracker = {
  /** The suggestion was offered to the editor. */
  shown: (latencyMs: number) => void
  /** The user took the whole suggestion. */
  accepted: (text: string, range: IRange) => void
  /** The user took a word or a line of it. */
  partial: () => void
  /** The answer arrived after the file had already moved on. */
  stale: () => void
  /** Stops watching and drops what was pending. */
  dispose: () => void
}

/**
 * Counts what became of a suggestion.
 *
 * Why the tracker holds the accepted text: an undo cannot be told apart from a deletion by the
 * editor's events, but both mean the same thing here — the suggestion was taken and then taken
 * back, which is what a bad suggestion looks like.
 */
export function createNesMetricTracker(params: {
  editorInstance: editor.IStandaloneCodeEditor
  /** The model the suggestion was shown in; the tracker watches it for the text being taken back. */
  model: () => editor.ITextModel | null
  /** The model the endpoint answers with; the counters are kept per model. */
  modelName: () => string
  /** Whether the suggestion that was shown is still the one on screen. */
  isStillShown: () => boolean
}): NesMetricTracker {
  let keptTimer: ReturnType<typeof setTimeout> | null = null
  let acceptedText: string | null = null
  let acceptedRange: IRange | null = null

  const report = (event: CodeCompletionMetricEvent, latencyMs?: number): void => {
    const report: CodeCompletionMetricReport = {
      event,
      model: params.modelName(),
      ...(latencyMs === undefined ? {} : { latencyMs })
    }
    void window.api?.codeCompletion?.recordMetric(report).catch(() => {
      // Why: the counters are a measurement, and a measurement that cannot be written must
      // not disturb the editor.
    })
  }

  const clearKeptTimer = (): void => {
    if (keptTimer !== null) {
      clearTimeout(keptTimer)
      keptTimer = null
    }
  }

  const contentSubscription = params.editorInstance.onDidChangeModelContent(() => {
    if (acceptedText === null || !acceptedRange) {
      return
    }
    const model = params.model()
    if (!model) {
      return
    }
    const current = model.getValueInRange(acceptedRange)
    if (current === acceptedText) {
      return
    }
    // Why: the text the person took is gone, so the suggestion was taken back.
    acceptedText = null
    acceptedRange = null
    report('undone')
  })

  return {
    shown(latencyMs: number): void {
      clearKeptTimer()
      report('shown', latencyMs)
      keptTimer = setTimeout(() => {
        keptTimer = null
        if (params.isStillShown()) {
          report('kept')
        }
      }, NES_KEPT_AFTER_MS)
    },
    accepted(text: string, range: IRange): void {
      clearKeptTimer()
      acceptedText = text
      acceptedRange = range
      report('accepted')
    },
    partial(): void {
      clearKeptTimer()
      report('partial')
    },
    stale(): void {
      report('stale')
    },
    dispose(): void {
      clearKeptTimer()
      contentSubscription.dispose()
    }
  }
}
