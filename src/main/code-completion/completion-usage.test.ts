import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as CompletionUsage from './completion-usage'

const files = new Map<string, Buffer>()
const existsSyncMock = vi.fn()
const readFileSyncMock = vi.fn()
const writeSecureFileMock = vi.fn()
const homedirMock = vi.fn(() => '/home/test')

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
  readFileSync: readFileSyncMock
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

const USAGE_PATH = '/home/test/.orca/code-completion-usage.json'
const ZERO = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }

/** Noon local time, so its day key is the same date in every timezone. */
const DAY = new Date(2026, 10, 20, 12).getTime()

async function loadUsage(): Promise<typeof CompletionUsage> {
  vi.resetModules()
  return await import('./completion-usage')
}

/** What the last write put in the mocked file. */
function savedUsage(): Record<string, unknown> {
  const raw = files.get(USAGE_PATH)
  return raw ? JSON.parse(raw.toString('utf8')) : {}
}

describe('completion usage', () => {
  beforeEach(() => {
    files.clear()
    existsSyncMock.mockImplementation((path: string) => files.has(path))
    readFileSyncMock.mockImplementation((path: string) => files.get(path) ?? Buffer.alloc(0))
    writeSecureFileMock.mockImplementation((path: string, contents: string) => {
      files.set(path, Buffer.from(contents, 'utf8'))
      return true
    })
    writeSecureFileMock.mockClear()
    homedirMock.mockReturnValue('/home/test')
  })

  it('reports nothing before the first completion', async () => {
    const usage = await loadUsage()

    expect(usage.readCompletionUsageToday(DAY)).toEqual(ZERO)
    expect(writeSecureFileMock).not.toHaveBeenCalled()
  })

  it('adds up the tokens of several completions', async () => {
    const usage = await loadUsage()

    usage.recordCompletionUsage({
      model: 'model-a',
      usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 2 },
      at: DAY
    })
    usage.recordCompletionUsage({
      model: 'model-a',
      usage: { inputTokens: 5, outputTokens: 7, cacheReadTokens: 1 },
      at: DAY + 60_000
    })

    expect(usage.readCompletionUsageToday(DAY + 120_000)).toEqual({
      inputTokens: 15,
      outputTokens: 10,
      cacheReadTokens: 3
    })
    expect(writeSecureFileMock).toHaveBeenCalledWith(USAGE_PATH, expect.any(String))
  })

  it('keeps the total across a restart', async () => {
    const first = await loadUsage()
    first.recordCompletionUsage({
      model: 'model-a',
      usage: { inputTokens: 4, outputTokens: 6, cacheReadTokens: 1 },
      at: DAY
    })

    const second = await loadUsage()

    expect(second.readCompletionUsageToday(DAY)).toEqual({
      inputTokens: 4,
      outputTokens: 6,
      cacheReadTokens: 1
    })
  })

  it('reads a corrupt file as nothing and replaces it on the next completion', async () => {
    files.set(USAGE_PATH, Buffer.from('{"2026-11-20":', 'utf8'))
    const usage = await loadUsage()

    expect(usage.readCompletionUsageToday(DAY)).toEqual(ZERO)

    usage.recordCompletionUsage({
      model: 'model-a',
      usage: { inputTokens: 2, outputTokens: 1, cacheReadTokens: 0 },
      at: DAY
    })

    expect(savedUsage()).toEqual({
      '2026-11-20': { inputTokens: 2, outputTokens: 1, cacheReadTokens: 0 }
    })
  })

  it('drops days older than its window', async () => {
    const usage = await loadUsage()
    const old = new Date(2026, 9, 1, 12).getTime()
    const recent = new Date(2026, 10, 15, 12).getTime()
    const spent = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 }

    usage.recordCompletionUsage({ model: 'model-a', usage: spent, at: old })
    usage.recordCompletionUsage({ model: 'model-a', usage: spent, at: recent })
    usage.recordCompletionUsage({ model: 'model-a', usage: spent, at: DAY })

    expect(Object.keys(savedUsage()).sort()).toEqual(['2026-11-15', '2026-11-20'])
  })

  it('does not throw when the file cannot be hardened', async () => {
    writeSecureFileMock.mockReturnValue(false)
    const usage = await loadUsage()

    expect(() =>
      usage.recordCompletionUsage({
        model: 'model-a',
        usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3 },
        at: DAY
      })
    ).not.toThrow()
  })
})
