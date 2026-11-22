import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { writeSecureFile } from '../../shared/secure-storage/secure-file'
import {
  CODE_COMPLETION_LATENCY_SAMPLE_LIMIT,
  emptyCodeCompletionMetricCounts,
  type CodeCompletionMetricEvent,
  type CodeCompletionMetricModel,
  type CodeCompletionMetricsFile
} from '../../shared/code-completion/code-completion-metrics'

const metricCountsSchema = z.object({
  shown: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative(),
  partial: z.number().int().nonnegative(),
  kept: z.number().int().nonnegative(),
  undone: z.number().int().nonnegative(),
  stale: z.number().int().nonnegative()
})

const metricModelSchema = metricCountsSchema.extend({
  latencySamples: z.array(z.number().int().nonnegative())
})

const metricsFileSchema = z.object({
  models: z.record(z.string(), metricModelSchema)
})

function completionMetricsFile(): string {
  return join(homedir(), '.orca', 'code-completion-metrics.json')
}

/**
 * The writes, one after the other.
 *
 * Why: two suggestions that land together would each read the file and each write its own
 * counters, and the second write would drop the first one's numbers.
 */
let metricWrites: Promise<void> = Promise.resolve()

/** What became of a suggestion, counted for the model that answered. */
export function recordCompletionMetric(report: {
  event: CodeCompletionMetricEvent
  model: string
  latencyMs?: number
}): Promise<void> {
  metricWrites = metricWrites.then(() => writeMetrics(report))
  return metricWrites
}

async function writeMetrics(report: {
  event: CodeCompletionMetricEvent
  model: string
  latencyMs?: number
}): Promise<void> {
  const path = completionMetricsFile()
  const file = await readMetricsFile(path)
  const model = file.models[report.model] ?? {
    ...emptyCodeCompletionMetricCounts(),
    latencySamples: []
  }
  model[report.event] += 1
  if (
    typeof report.latencyMs === 'number' &&
    Number.isFinite(report.latencyMs) &&
    report.latencyMs >= 0
  ) {
    model.latencySamples.push(Math.round(report.latencyMs))
    if (model.latencySamples.length > CODE_COMPLETION_LATENCY_SAMPLE_LIMIT) {
      model.latencySamples = model.latencySamples.slice(-CODE_COMPLETION_LATENCY_SAMPLE_LIMIT)
    }
  }
  file.models[report.model] = model
  try {
    writeSecureFile(path, JSON.stringify(file, null, 2))
  } catch (error) {
    // Why: the counters are a measurement, and a measurement that cannot be written must not
    // disturb the editor.
    console.warn('[code-completion] Failed to record the completion metric.', error)
  }
}

/** The metrics that were counted, or none when the file is missing or unreadable. */
export async function readCompletionMetrics(): Promise<CodeCompletionMetricsFile> {
  return readMetricsFile(completionMetricsFile())
}

async function readMetricsFile(path: string): Promise<CodeCompletionMetricsFile> {
  try {
    const parsed = metricsFileSchema.safeParse(JSON.parse((await readFile(path)).toString('utf8')))
    return parsed.success ? parsed.data : { models: {} }
  } catch {
    return { models: {} }
  }
}

/** The median of the samples, or null when there are none. */
export function medianLatency(samples: readonly number[]): number | null {
  if (samples.length === 0) {
    return null
  }
  const sorted = [...samples].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle]
}

/** The share of the samples under the given share, or null when there are none. */
export function percentileLatency(samples: readonly number[], share: number): number | null {
  if (samples.length === 0) {
    return null
  }
  const sorted = [...samples].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1))
  return sorted[index]
}

/** The counters of one model, with the empty ones filled in. */
export function codeCompletionMetricModel(
  file: CodeCompletionMetricsFile,
  model: string
): CodeCompletionMetricModel {
  return file.models[model] ?? { ...emptyCodeCompletionMetricCounts(), latencySamples: [] }
}
