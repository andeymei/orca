import type { NesRequest } from '../../shared/code-completion/code-completion-types'
import { PrioritySemaphore } from '../../shared/priority-semaphore'
import { emptyCompletionUsage, type NesBackend, type NesBackendResult } from './completion-backend'
import { completionCache, completionCacheKey, type CompletionCache } from './completion-cache'

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
  const cache = options.cache ?? completionCache
  // The caller's clock measures the deadline only; the cache ages with its own.
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
        prefixStartLine: input.prefixStartLine,
        source: backend.identity,
        relatedFiles: input.relatedFiles.map((relatedFile) => ({
          path: relatedFile.path,
          content: relatedFile.content
        }))
      })
      const cached = cache.get(key)
      if (cached) {
        return { plan: cached, usage: emptyCompletionUsage() }
      }
      const outcome = await requestPlan(backend, input, signal, now)
      if (outcome.kind === 'abandoned') {
        return { plan: null, usage: emptyCompletionUsage() }
      }
      if (outcome.kind === 'failed') {
        console.error('[code-completion] The request failed.', {
          backend: backend.id,
          error: errorName(outcome.error)
        })
        return { plan: null, usage: emptyCompletionUsage() }
      }
      if (!outcome.result.plan) {
        console.error('[code-completion] The endpoint returned no plan.', { backend: backend.id })
        return { plan: null, usage: outcome.result.usage }
      }
      cache.set(key, outcome.result.plan)
      return outcome.result
    }
  }
}

type CompletionOutcome =
  | { kind: 'answered'; result: NesBackendResult }
  | { kind: 'failed'; error: unknown }
  | { kind: 'abandoned' }

/** The error's class name; its message can carry the request or the model's answer. */
function errorName(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return 'unknown'
  }
  const name: unknown = Reflect.get(error, 'name')
  return typeof name === 'string' ? name : 'unknown'
}

/** The backend's answer, or why there is none. */
async function requestPlan(
  backend: NesBackend,
  input: NesRequest,
  signal: AbortSignal,
  now: () => number
): Promise<CompletionOutcome> {
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
        return { kind: 'abandoned' }
      }
      return { kind: 'answered', result }
    } finally {
      release()
    }
  } catch (error) {
    // The caller typed on or the request timed out; neither is an error worth writing down.
    return controller.signal.aborted ? { kind: 'abandoned' } : { kind: 'failed', error }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abortFromCaller)
  }
}
