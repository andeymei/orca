import type { NesRequest } from '../../shared/code-completion/code-completion-types'
import { PrioritySemaphore } from '../../shared/priority-semaphore'
import { emptyCompletionUsage, type NesBackend, type NesBackendResult } from './completion-backend'
import { completionCacheKey, createCompletionCache, type CompletionCache } from './completion-cache'

/** A request that has not answered in eight seconds is abandoned, the queue wait included. */
export const NES_COMPLETION_REQUEST_TIMEOUT_MS = 8_000
/** The endpoint takes four requests at a time; a fifth one waits in the queue. */
export const NES_COMPLETION_MAX_CONCURRENT_REQUESTS = 4

export type CompletionService = {
  plan(input: NesRequest, signal: AbortSignal): Promise<NesBackendResult>
}

/** The cap is global, because the service is created per request and a per-service cap would never bind. */
const requestSlots = new PrioritySemaphore(NES_COMPLETION_MAX_CONCURRENT_REQUESTS)

export function createCompletionService(options: {
  resolveBackend: () => NesBackend | null
  cache?: CompletionCache
  now?: () => number
}): CompletionService {
  // The clock is the one the cache ages with, so a caller that fakes time fakes both.
  const cache = options.cache ?? createCompletionCache({ now: options.now })
  const now = options.now ?? Date.now

  return {
    async plan(input, signal) {
      const backend = options.resolveBackend()
      if (!backend) {
        return { plan: null, usage: emptyCompletionUsage() }
      }
      const key = completionCacheKey({
        filePath: input.filePath,
        prefix: input.prefix,
        suffix: input.suffix,
        relatedPaths: input.relatedFiles.map((relatedFile) => relatedFile.path)
      })
      const cached = cache.get(key)
      if (cached) {
        return { plan: cached, usage: emptyCompletionUsage() }
      }
      const result = await requestPlan(backend, input, signal, now)
      if (!result?.plan) {
        return { plan: null, usage: result?.usage ?? emptyCompletionUsage() }
      }
      cache.set(key, result.plan)
      return result
    }
  }
}

/** The backend's answer, or null when the request failed, timed out or was abandoned. */
async function requestPlan(
  backend: NesBackend,
  input: NesRequest,
  signal: AbortSignal,
  now: () => number
): Promise<NesBackendResult | null> {
  const controller = new AbortController()
  const abortFromCaller = (): void => controller.abort(signal.reason)
  if (signal.aborted) {
    controller.abort(signal.reason)
  } else {
    signal.addEventListener('abort', abortFromCaller, { once: true })
  }
  let markTimedOut: (result: null) => void = () => {}
  const timedOut = new Promise<null>((resolve) => {
    markTimedOut = resolve
  })
  const timer = setTimeout(() => {
    controller.abort(new Error('The completion request timed out.'))
    markTimedOut(null)
  }, NES_COMPLETION_REQUEST_TIMEOUT_MS)
  const deadline = now() + NES_COMPLETION_REQUEST_TIMEOUT_MS
  try {
    const release = await requestSlots.acquire(0, controller.signal)
    try {
      const result = await Promise.race([backend.plan(input, controller.signal), timedOut])
      // An answer that arrives after the deadline is stale: the file moved on while it was in flight.
      if (result === null || now() > deadline || signal.aborted) {
        return null
      }
      return result
    } finally {
      release()
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abortFromCaller)
  }
}
