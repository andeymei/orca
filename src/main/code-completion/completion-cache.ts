import { createHash } from 'node:crypto'
import type { NesEditPlan } from '../../shared/code-completion/code-completion-types'

/** A plan lives half a minute; past that the file has moved on under it. */
export const NES_COMPLETION_CACHE_TTL_MS = 30_000
/** A file keeps ten plans, so a long session cannot grow the cache without bound. */
export const NES_COMPLETION_CACHE_MAX_PER_FILE = 10

export type CompletionCache = {
  get(key: string): NesEditPlan | null
  set(key: string, plan: NesEditPlan): void
  clear(): void
}

type CompletionCacheEntry = {
  plan: NesEditPlan
  storedAt: number
  lastUsedAt: number
}

/** A NUL byte cannot appear in a path or in file text, so it separates the hashed parts. */
const SEGMENT_SEPARATOR = String.fromCharCode(0)

/** The key of one cursor context: the file it belongs to, the text around the cursor and its offset. */
export function completionCacheKey(input: {
  filePath: string
  prefix: string
  suffix: string
  /** The file line the shown prefix starts at; the plan's line numbers count from it. */
  prefixStartLine: number
  relatedPaths: readonly string[]
}): string {
  const file = digest(input.filePath)
  const context = digest(
    [
      input.prefix,
      input.suffix,
      String(input.prefixStartLine),
      ...[...input.relatedPaths].sort()
    ].join(SEGMENT_SEPARATOR)
  )
  return `${file}${SEGMENT_SEPARATOR}${context}`
}

export function createCompletionCache(
  options: { ttlMs?: number; maxPerFile?: number; now?: () => number } = {}
): CompletionCache {
  const ttlMs = options.ttlMs ?? NES_COMPLETION_CACHE_TTL_MS
  const maxPerFile = options.maxPerFile ?? NES_COMPLETION_CACHE_MAX_PER_FILE
  const now = options.now ?? Date.now
  const entries = new Map<string, CompletionCacheEntry>()

  const get = (key: string): NesEditPlan | null => {
    const entry = entries.get(key)
    if (!entry) {
      return null
    }
    const timestamp = now()
    if (timestamp - entry.storedAt >= ttlMs) {
      entries.delete(key)
      return null
    }
    entry.lastUsedAt = timestamp
    return entry.plan
  }

  const evictOverflowingFile = (key: string): void => {
    const file = fileSegment(key)
    const fileEntries = [...entries.entries()].filter(
      ([candidateKey]) => fileSegment(candidateKey) === file
    )
    if (fileEntries.length <= maxPerFile) {
      return
    }
    const oldestFirst = fileEntries.sort(
      ([, left], [, right]) => left.lastUsedAt - right.lastUsedAt
    )
    for (const [oldestKey] of oldestFirst.slice(0, fileEntries.length - maxPerFile)) {
      entries.delete(oldestKey)
    }
  }

  const set = (key: string, plan: NesEditPlan): void => {
    const timestamp = now()
    entries.set(key, { plan, storedAt: timestamp, lastUsedAt: timestamp })
    evictOverflowingFile(key)
  }

  return {
    get,
    set,
    clear: () => {
      entries.clear()
    }
  }
}

/** The file a key belongs to; the keys of one file share their cap. */
function fileSegment(key: string): string {
  const separator = key.indexOf(SEGMENT_SEPARATOR)
  return separator === -1 ? key : key.slice(0, separator)
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32)
}

/** The cache outlives the request: the same context comes back on the next pause in typing. */
export const completionCache: CompletionCache = createCompletionCache()
