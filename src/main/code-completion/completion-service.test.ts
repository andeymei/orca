import { describe, expect, it, vi } from 'vitest'
import type { NesEditPlan, NesRequest } from '../../shared/code-completion/code-completion-types'
import { emptyCompletionUsage, type NesBackend, type NesBackendResult } from './completion-backend'
import { createCompletionCache } from './completion-cache'
import { createCompletionService } from './completion-service'

const FILE_PATH = '/repo/src/foo.ts'

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

function backendAnswering(result: NesBackendResult): { backend: NesBackend; calls: () => number } {
  let calls = 0
  return {
    backend: {
      id: 'anthropic-messages',
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
  })

  it('does not cache an aborted request', async () => {
    const controller = new AbortController()
    const firstAnswer = deferred<NesBackendResult>()
    let calls = 0
    const backend: NesBackend = {
      id: 'anthropic-messages',
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
  })

  it('gives up after the request timeout', async () => {
    vi.useFakeTimers()
    try {
      const backend: NesBackend = {
        id: 'anthropic-messages',
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
