import { describe, expect, it } from 'vitest'
import type { NesEditPlan } from '../../shared/code-completion/code-completion-types'
import { completionCacheKey, createCompletionCache } from './completion-cache'

const FILE_PATH = '/repo/src/foo.ts'
const OTHER_FILE_PATH = '/repo/src/bar.ts'
const SOURCE = 'anthropic-messages|https://endpoint.invalid|test-model|no-auto-import'

function plan(label: string): NesEditPlan {
  return {
    edits: [
      {
        id: 'e1',
        path: FILE_PATH,
        kind: 'insert',
        range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
        originalText: '',
        text: `${label}\n`,
        label
      }
    ]
  }
}

function keyFor(filePath: string, prefix: string): string {
  return completionCacheKey({
    filePath,
    prefix,
    suffix: '',
    prefixStartLine: 1,
    source: SOURCE,
    relatedFiles: []
  })
}

describe('completion cache', () => {
  it('returns a cached plan within the ttl', () => {
    let clock = 1_000
    const cache = createCompletionCache({ now: () => clock })
    const key = keyFor(FILE_PATH, 'const a = 1')

    cache.set(key, plan('a'))
    clock += 29_999

    expect(cache.get(key)).toEqual(plan('a'))
  })

  it('expires a cached plan after the ttl', () => {
    let clock = 1_000
    const cache = createCompletionCache({ now: () => clock })
    const key = keyFor(FILE_PATH, 'const a = 1')

    cache.set(key, plan('a'))
    clock += 30_000

    expect(cache.get(key)).toBeNull()
  })

  it('keeps at most ten plans per file and evicts the least recently used', () => {
    let clock = 1_000
    const cache = createCompletionCache({ now: () => clock })
    const keys = Array.from({ length: 10 }, (_, index) => keyFor(FILE_PATH, `line ${index}`))
    for (const [index, key] of keys.entries()) {
      clock += 1
      cache.set(key, plan(`line ${index}`))
    }
    // Reading the first plan makes it the most recently used one.
    clock += 1
    expect(cache.get(keys[0])).toEqual(plan('line 0'))
    const otherFileKey = keyFor(OTHER_FILE_PATH, 'line 0')
    clock += 1
    cache.set(otherFileKey, plan('other file'))

    clock += 1
    cache.set(keyFor(FILE_PATH, 'line 10'), plan('line 10'))

    expect(cache.get(keys[1])).toBeNull()
    expect(cache.get(keys[0])).toEqual(plan('line 0'))
    expect(cache.get(otherFileKey)).toEqual(plan('other file'))
  })

  it('keys a plan by the cursor context so a moved cursor misses', () => {
    const cache = createCompletionCache()
    const context = {
      filePath: FILE_PATH,
      prefix: 'const a = 1\n',
      suffix: 'const b = 2',
      prefixStartLine: 1,
      source: SOURCE,
      relatedFiles: [{ path: OTHER_FILE_PATH, content: 'export const bar = 1\n' }]
    }
    const key = completionCacheKey(context)
    const movedKey = completionCacheKey({ ...context, prefix: 'const a = 1\nconst c = 3\n' })
    cache.set(key, plan('a'))

    expect(cache.get(movedKey)).toBeNull()
    expect(cache.get(key)).toEqual(plan('a'))
    expect(completionCacheKey(context)).toBe(key)
  })

  it('gives another key to another set of related files', () => {
    const context = {
      filePath: FILE_PATH,
      prefix: 'const a = 1\n',
      suffix: 'const b = 2',
      prefixStartLine: 1,
      source: SOURCE
    }

    expect(
      completionCacheKey({ ...context, relatedFiles: [{ path: OTHER_FILE_PATH, content: 'a\n' }] })
    ).not.toBe(
      completionCacheKey({
        ...context,
        relatedFiles: [{ path: '/repo/src/baz.ts', content: 'a\n' }]
      })
    )
  })

  it('gives another key when a related file changed', () => {
    const context = {
      filePath: FILE_PATH,
      prefix: 'const a = 1\n',
      suffix: 'const b = 2',
      prefixStartLine: 1,
      source: SOURCE
    }

    expect(
      completionCacheKey({
        ...context,
        relatedFiles: [{ path: OTHER_FILE_PATH, content: 'export const bar = 1\n' }]
      })
    ).not.toBe(
      completionCacheKey({
        ...context,
        relatedFiles: [{ path: OTHER_FILE_PATH, content: 'export const bar = 2\n' }]
      })
    )
  })

  it('gives the same key to the same related files in another order', () => {
    const context = {
      filePath: FILE_PATH,
      prefix: 'const a = 1\n',
      suffix: 'const b = 2',
      prefixStartLine: 1,
      source: SOURCE
    }
    const relatedFiles = [
      { path: OTHER_FILE_PATH, content: 'export const bar = 1\n' },
      { path: '/repo/src/baz.ts', content: 'export const baz = 2\n' }
    ]

    expect(completionCacheKey({ ...context, relatedFiles })).toBe(
      completionCacheKey({ ...context, relatedFiles: relatedFiles.toReversed() })
    )
  })

  it('gives another key to the same text at another line', () => {
    const context = {
      filePath: FILE_PATH,
      prefix: 'const a = 1\n',
      suffix: 'const b = 2',
      source: SOURCE,
      relatedFiles: []
    }

    expect(completionCacheKey({ ...context, prefixStartLine: 1 })).not.toBe(
      completionCacheKey({ ...context, prefixStartLine: 40 })
    )
  })

  it('gives another key to another model', () => {
    const context = {
      filePath: FILE_PATH,
      prefix: 'const a = 1\n',
      suffix: 'const b = 2',
      prefixStartLine: 1,
      relatedFiles: []
    }

    expect(completionCacheKey({ ...context, source: SOURCE })).not.toBe(
      completionCacheKey({ ...context, source: `${SOURCE}|auto-import` })
    )
  })
})
