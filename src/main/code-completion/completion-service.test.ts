import { describe, expect, it, vi } from 'vitest'
import type { NesEditPlan, NesRequest } from '../../shared/code-completion/code-completion-types'
import { emptyCompletionUsage, type NesBackend, type NesBackendResult } from './completion-backend'
import { completionCache, createCompletionCache } from './completion-cache'
import { createCompletionService } from './completion-service'

const FILE_PATH = '/repo/src/foo.ts'
const IDENTITY = 'anthropic-messages|https://endpoint.invalid|test-model|no-auto-import'

const PLAN: NesEditPlan = {
  edits: [
    {
      id: 'e1',
      path: FILE_PATH,
      kind: 'insert',
      range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      originalText: '',
      text: 'const c = 3\n',
      label: 'add the third constant'
    }
  ]
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void }

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function request(overrides: Partial<NesRequest> = {}): NesRequest {
  return {
    filePath: FILE_PATH,
    relativePath: 'src/foo.ts',
    languageId: 'typescript',
    prefix: 'const a = 1\n',
    suffix: '\nconst b = 2',
    prefixStartLine: 1,
    cursorLine: 1,
    cursorColumn: 1,
    relatedFiles: [],
    recentEdits: [],
    ...overrides
  }
}

function backendAnswering(
  result: NesBackendResult,
  identity = IDENTITY
): { backend: NesBackend; calls: () => number } {
  let calls = 0
  return {
    backend: {
      id: 'anthropic-messages',
      identity,
      planCapable: true,
      plan: async () => {
        calls += 1
        return result
      }
    },
    calls: () => calls
  }
}

/** Lets the queued microtasks run so the backend has been called. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

describe('completion service', () => {
  it('asks the backend once and serves the second identical request from the cache', async () => {
    const { backend, calls } = backendAnswering({ plan: PLAN, usage: emptyCompletionUsage() })
    const service = createCompletionService({
      resolveBackend: () => backend,
      cache: createCompletionCache()
    })

    const first = await service.plan(request(), new AbortController().signal)
    const second = await service.plan(request(), new AbortController().signal)

    expect(first.plan).toEqual(PLAN)
    expect(second.plan).toEqual(PLAN)
    expect(calls()).toBe(1)
  })

  it('returns null when no backend is configured', async () => {
    const service = createCompletionService({
      resolveBackend: () => null,
      cache: createCompletionCache()
    })

    const result = await service.plan(request(), new AbortController().signal)

    expect(result.plan).toBeNull()
  })

  it('does not cache a failure', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { backend, calls } = backendAnswering({ plan: null, usage: emptyCompletionUsage() })
      const service = createCompletionService({
        resolveBackend: () => backend,
        cache: createCompletionCache()
      })

      const first = await service.plan(request(), new AbortController().signal)
      const second = await service.plan(request(), new AbortController().signal)

      expect(first.plan).toBeNull()
      expect(second.plan).toBeNull()
      expect(calls()).toBe(2)
      expect(log).toHaveBeenCalledTimes(2)
      expect(log).toHaveBeenCalledWith('[code-completion] The endpoint returned no plan.', {
        backend: 'anthropic-messages'
      })
    } finally {
      log.mockRestore()
    }
  })

  it('writes a failed request down without its payload', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const backend: NesBackend = {
        id: 'anthropic-messages',
        identity: IDENTITY,
        planCapable: true,
        plan: () => Promise.reject(new TypeError('the request carried x-api-key: sk-secret'))
      }
      const service = createCompletionService({
        resolveBackend: () => backend,
        cache: createCompletionCache()
      })

      const result = await service.plan(request(), new AbortController().signal)

      expect(result.plan).toBeNull()
      expect(log).toHaveBeenCalledWith('[code-completion] The request failed.', {
        backend: 'anthropic-messages',
        error: 'TypeError'
      })
    } finally {
      log.mockRestore()
    }
  })

  it('does not cache an aborted request', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const controller = new AbortController()
      const firstAnswer = deferred<NesBackendResult>()
      let calls = 0
      const backend: NesBackend = {
        id: 'anthropic-messages',
        identity: IDENTITY,
        planCapable: true,
        plan: () => {
          calls += 1
          if (calls > 1) {
            return Promise.resolve({ plan: PLAN, usage: emptyCompletionUsage() })
          }
          return firstAnswer.promise
        }
      }
      const service = createCompletionService({
        resolveBackend: () => backend,
        cache: createCompletionCache()
      })

      const pending = service.plan(request(), controller.signal)
      await flushMicrotasks()
      controller.abort()
      firstAnswer.resolve({ plan: PLAN, usage: emptyCompletionUsage() })
      const aborted = await pending
      expect(aborted.plan).toBeNull()

      const second = await service.plan(request(), new AbortController().signal)
      expect(second.plan).toEqual(PLAN)
      expect(calls).toBe(2)
      // The user typed on; that is not an error worth writing down.
      expect(log).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
  })

  it('does not write an aborted request down', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const controller = new AbortController()
      const backend: NesBackend = {
        id: 'anthropic-messages',
        identity: IDENTITY,
        planCapable: true,
        plan: (_input, signal) =>
          new Promise<NesBackendResult>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('The request was aborted.')), {
              once: true
            })
          })
      }
      const service = createCompletionService({
        resolveBackend: () => backend,
        cache: createCompletionCache()
      })

      const pending = service.plan(request(), controller.signal)
      await flushMicrotasks()
      controller.abort()
      const aborted = await pending

      expect(aborted.plan).toBeNull()
      expect(log).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
  })

  it('does not serve one model’s answer to another model', async () => {
    const cache = createCompletionCache()
    const first = backendAnswering(
      { plan: PLAN, usage: emptyCompletionUsage() },
      'anthropic-messages|https://endpoint.invalid|test-model|auto-import'
    )
    const second = backendAnswering(
      { plan: PLAN, usage: emptyCompletionUsage() },
      'anthropic-messages|https://endpoint.invalid|test-model|no-auto-import'
    )
    const firstService = createCompletionService({ resolveBackend: () => first.backend, cache })
    const secondService = createCompletionService({ resolveBackend: () => second.backend, cache })

    await firstService.plan(request(), new AbortController().signal)
    await secondService.plan(request(), new AbortController().signal)

    expect(first.calls()).toBe(1)
    expect(second.calls()).toBe(1)
  })

  it('serves a later request from the shared cache', async () => {
    completionCache.clear()
    const { backend, calls } = backendAnswering({ plan: PLAN, usage: emptyCompletionUsage() })
    const first = createCompletionService({ resolveBackend: () => backend })
    const second = createCompletionService({ resolveBackend: () => backend })
    const shared = request({ filePath: '/repo/src/shared-cache.ts' })

    await first.plan(shared, new AbortController().signal)
    const served = await second.plan(shared, new AbortController().signal)

    expect(served.plan).toEqual(PLAN)
    expect(calls()).toBe(1)
  })

  it('gives up after the request timeout', async () => {
    vi.useFakeTimers()
    try {
      const backend: NesBackend = {
        id: 'anthropic-messages',
        identity: IDENTITY,
        planCapable: true,
        plan: () => new Promise<NesBackendResult>(() => {})
      }
      const service = createCompletionService({
        resolveBackend: () => backend,
        cache: createCompletionCache()
      })

      const pending = service.plan(request(), new AbortController().signal)
      await vi.advanceTimersByTimeAsync(8_000)
      const result = await pending

      expect(result.plan).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('runs at most four requests at once', async () => {
    const answers: Deferred<NesBackendResult>[] = []
    let started = 0
    let inFlight = 0
    let peak = 0
    const backend: NesBackend = {
      id: 'anthropic-messages',
      identity: IDENTITY,
      planCapable: true,
      plan: () => {
        started += 1
        inFlight += 1
        peak = Math.max(peak, inFlight)
        const answer = deferred<NesBackendResult>()
        answers.push(answer)
        return answer.promise.finally(() => {
          inFlight -= 1
        })
      }
    }
    const service = createCompletionService({
      resolveBackend: () => backend,
      cache: createCompletionCache()
    })

    const pending = Array.from({ length: 5 }, (_, index) =>
      service.plan(request({ prefix: `const a = ${index}\n` }), new AbortController().signal)
    )
    await flushMicrotasks()
    expect(started).toBe(4)

    answers[0]?.resolve({ plan: PLAN, usage: emptyCompletionUsage() })
    await flushMicrotasks()
    expect(started).toBe(5)
    expect(peak).toBe(4)

    for (const answer of answers.slice(1)) {
      answer.resolve({ plan: PLAN, usage: emptyCompletionUsage() })
    }
    await Promise.all(pending)
  })
})
