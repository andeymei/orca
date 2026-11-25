import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as CompletionUsage from './completion-usage'

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

vi.mock('../../shared/secure-storage/secure-file-async-write', () => ({
  writeSecureFileAsync: writeSecureFileMock
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
    readFileMock.mockImplementation((path: string): Promise<Buffer> => {
      const content = files.get(path)
      return content
        ? Promise.resolve(content)
        : Promise.reject(new Error(`ENOENT: no such file or directory, open '${path}'`))
    })
    writeSecureFileMock.mockImplementation((path: string, contents: string) => {
      files.set(path, Buffer.from(contents, 'utf8'))
      return true
    })
    writeSecureFileMock.mockClear()
    homedirMock.mockReturnValue('/home/test')
  })

  it('reports nothing before the first completion', async () => {
    const usage = await loadUsage()

    expect(await usage.readCompletionUsageToday(DAY)).toEqual(ZERO)
    expect(writeSecureFileMock).not.toHaveBeenCalled()
  })

  it('adds up the tokens of several completions', async () => {
    const usage = await loadUsage()

    await usage.recordCompletionUsage({
      model: 'model-a',
      usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 2 },
      at: DAY
    })
    await usage.recordCompletionUsage({
      model: 'model-a',
      usage: { inputTokens: 5, outputTokens: 7, cacheReadTokens: 1 },
      at: DAY + 60_000
    })

    expect(await usage.readCompletionUsageToday(DAY + 120_000)).toEqual({
      inputTokens: 15,
      outputTokens: 10,
      cacheReadTokens: 3
    })
    expect(writeSecureFileMock).toHaveBeenCalledWith(USAGE_PATH, expect.any(String))
  })

  it('keeps the total across a restart', async () => {
    const first = await loadUsage()
    await first.recordCompletionUsage({
      model: 'model-a',
      usage: { inputTokens: 4, outputTokens: 6, cacheReadTokens: 1 },
      at: DAY
    })

    const second = await loadUsage()

    expect(await second.readCompletionUsageToday(DAY)).toEqual({
      inputTokens: 4,
      outputTokens: 6,
      cacheReadTokens: 1
    })
  })

  it('reads a corrupt file as nothing and replaces it on the next completion', async () => {
    files.set(USAGE_PATH, Buffer.from('{"2026-11-20":', 'utf8'))
    const usage = await loadUsage()

    expect(await usage.readCompletionUsageToday(DAY)).toEqual(ZERO)

    await usage.recordCompletionUsage({
      model: 'model-a',
      usage: { inputTokens: 2, outputTokens: 1, cacheReadTokens: 0 },
      at: DAY
    })

    expect(savedUsage()).toEqual({
      '2026-11-20': { inputTokens: 2, outputTokens: 1, cacheReadTokens: 0 }
    })
  })

  it('keeps the last 30 days and drops the rest', async () => {
    const usage = await loadUsage()
    const dayThirtyOne = new Date(2026, 9, 20, 12).getTime()
    const cutoffDay = new Date(2026, 9, 21, 12).getTime()
    const firstKept = new Date(2026, 9, 22, 12).getTime()
    const spent = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 }

    await usage.recordCompletionUsage({ model: 'model-a', usage: spent, at: dayThirtyOne })
    await usage.recordCompletionUsage({ model: 'model-a', usage: spent, at: cutoffDay })
    await usage.recordCompletionUsage({ model: 'model-a', usage: spent, at: firstKept })
    await usage.recordCompletionUsage({ model: 'model-a', usage: spent, at: DAY })

    expect(Object.keys(savedUsage()).sort()).toEqual(['2026-10-22', '2026-11-20'])
  })

  it('keys a completion by the local day, not the UTC day', async () => {
    const usage = await loadUsage()
    const justAfterLocalMidnight = new Date('2026-11-20T00:05:00').getTime()
    const justBeforeLocalMidnight = new Date('2026-11-20T23:55:00').getTime()
    const spent = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 }

    await usage.recordCompletionUsage({
      model: 'model-a',
      usage: spent,
      at: justAfterLocalMidnight
    })
    await usage.recordCompletionUsage({
      model: 'model-a',
      usage: spent,
      at: justBeforeLocalMidnight
    })

    expect(Object.keys(savedUsage())).toEqual(['2026-11-20'])
    expect(await usage.readCompletionUsageToday(new Date('2026-11-20T12:00:00').getTime())).toEqual(
      {
        inputTokens: 2,
        outputTokens: 2,
        cacheReadTokens: 0
      }
    )
  })

  it('does not throw when the file cannot be hardened', async () => {
    writeSecureFileMock.mockReturnValue(false)
    const usage = await loadUsage()

    await expect(
      usage.recordCompletionUsage({
        model: 'model-a',
        usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3 },
        at: DAY
      })
    ).resolves.toBeUndefined()
  })
})
