/**
 * What happened to a suggestion after it was shown.
 *
 * Why the counters are kept per model: a model that is accepted often and kept is a good fit,
 * and one that is accepted and then deleted is not. The numbers are the only honest way to tell
 * the two apart.
 */
export type CodeCompletionMetricEvent =
  /** The suggestion was offered to the editor. */
  | 'shown'
  /** The user took the whole suggestion. */
  | 'accepted'
  /** The user took a word or a line of it. */
  | 'partial'
  /** The suggestion was still on screen half a minute later. */
  | 'kept'
  /** The text the user took was taken back. */
  | 'undone'
  /** The answer arrived after the file had already moved on. */
  | 'stale'

export type CodeCompletionMetricReport = {
  /** What happened. */
  event: CodeCompletionMetricEvent
  /** The model the suggestion came from. */
  model: string
  /** How long the answer took, in milliseconds. */
  latencyMs?: number
}

/** The IPC channel both sides of the metric report use. */
export const CODE_COMPLETION_METRIC_CHANNELS = {
  recordMetric: 'codeCompletion:recordMetric'
} as const

/** The counters one model keeps. */
export type CodeCompletionMetricCounts = {
  shown: number
  accepted: number
  partial: number
  kept: number
  undone: number
  stale: number
}

export type CodeCompletionMetricModel = CodeCompletionMetricCounts & {
  /** The recent answers' durations, so the median and the 95th percentile can be read from them. */
  latencySamples: number[]
}

/** How many samples the percentiles are read from; the window keeps the file from growing. */
export const CODE_COMPLETION_LATENCY_SAMPLE_LIMIT = 200

/** The file's shape: the counters and the samples, per model. */
export type CodeCompletionMetricsFile = {
  models: Record<string, CodeCompletionMetricModel>
}

/** The counters a fresh model starts with. */
export function emptyCodeCompletionMetricCounts(): CodeCompletionMetricCounts {
  return { shown: 0, accepted: 0, partial: 0, kept: 0, undone: 0, stale: 0 }
}
