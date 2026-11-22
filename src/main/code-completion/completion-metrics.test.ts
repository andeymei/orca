import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as CompletionMetrics from './completion-metrics'

const files = new Map<string, Buffer>()
const readFileMock = vi.fn()
const writeSecureFileMock = vi.fn()
const homedirMock = vi.fn(() => '/home/test')

vi.mock('node:fs/promises', () => ({
  readFile: readFileMock
}))

vi.mock('node:os', () => ({
  homedir: homedirMock
}))

vi.mock('node:path', () => ({
  join: (...parts: string[]) => parts.join('/')
}))

vi.mock('../../shared/secure-storage/secure-file', () => ({
  writeSecureFile: writeSecureFileMock
}))

const METRICS_PATH = '/home/test/.orca/code-completion-metrics.json'

async function loadMetrics(): Promise<typeof CompletionMetrics> {
  vi.resetModules()
  return await import('./completion-metrics')
}

type SavedMetricModel = {
  shown: number
  accepted: number
  latencySamples: number[]
}

/** What the last write put in the mocked file. */
function savedMetrics(): { models: Record<string, SavedMetricModel> } {
  const raw = files.get(METRICS_PATH)
  return raw ? JSON.parse(raw.toString('utf8')) : { models: {} }
}

describe('the completion metrics', () => {
  beforeEach(() => {
    files.clear()
    readFileMock.mockImplementation((path: string): Promise<Buffer> => {
      const stored = files.get(path)
      return stored ? Promise.resolve(stored) : Promise.reject(new Error('the file is not there'))
    })
    writeSecureFileMock.mockImplementation((path: string, content: string) => {
      files.set(path, Buffer.from(content, 'utf8'))
    })
  })

  it('counts what happened for the model that answered', async () => {
    const metrics = await loadMetrics()

    await metrics.recordCompletionMetric({ event: 'shown', model: 'a-model', latencyMs: 120 })
    await metrics.recordCompletionMetric({ event: 'accepted', model: 'a-model' })
    await metrics.recordCompletionMetric({ event: 'accepted', model: 'a-model' })

    const saved = savedMetrics()
    expect(saved.models['a-model'].shown).toBe(1)
    expect(saved.models['a-model'].accepted).toBe(2)
    expect(saved.models['a-model'].latencySamples).toEqual([120])
  })

  it('keeps the counters of each model apart', async () => {
    const metrics = await loadMetrics()

    await metrics.recordCompletionMetric({ event: 'shown', model: 'a-model' })
    await metrics.recordCompletionMetric({ event: 'shown', model: 'other-model' })

    const saved = savedMetrics()
    expect(saved.models['a-model'].shown).toBe(1)
    expect(saved.models['other-model'].shown).toBe(1)
  })

  it('keeps only the last samples, so the file cannot grow without bound', async () => {
    const metrics = await loadMetrics()

    for (let index = 0; index < 210; index += 1) {
      await metrics.recordCompletionMetric({ event: 'shown', model: 'a-model', latencyMs: index })
    }

    const saved = savedMetrics()
    const samples = saved.models['a-model'].latencySamples
    expect(samples).toHaveLength(200)
    expect(samples[0]).toBe(10)
    expect(samples.at(-1)).toBe(209)
  })

  it('reads the median and the 95th percentile of the answers', async () => {
    const metrics = await loadMetrics()
    const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]

    expect(metrics.medianLatency(samples)).toBe(55)
    expect(metrics.percentileLatency(samples, 0.95)).toBe(100)
    expect(metrics.medianLatency([])).toBeNull()
  })

  it('starts a model that was never seen with empty counters', async () => {
    const metrics = await loadMetrics()

    const model = metrics.codeCompletionMetricModel({ models: {} }, 'a-model')
    expect(model.shown).toBe(0)
    expect(model.latencySamples).toEqual([])
  })
})
