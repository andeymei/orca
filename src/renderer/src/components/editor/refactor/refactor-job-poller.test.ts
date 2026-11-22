import { afterEach, describe, expect, it, vi } from 'vitest'
import { pollRefactorJob } from './refactor-job-poller'
import type { RefactorStatusResult } from '../../../../../shared/rpc-contract/refactor-params'

describe('pollRefactorJob', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('polls until the job leaves the running state', async () => {
    vi.useFakeTimers()
    const states: RefactorStatusResult['state'][] = ['running', 'running', 'done']
    let call = 0
    const seen: string[] = []
    const stop = pollRefactorJob({
      jobId: 'job-1',
      intervalMs: 1000,
      fetchStatus: async () => ({ state: states[call++], progress: '', warnings: [] }),
      onStatus: (status) => seen.push(status.state)
    })
    await vi.advanceTimersByTimeAsync(3500)
    stop()
    expect(seen).toEqual(['running', 'running', 'done'])
  })

  it('stops polling once the job is done', async () => {
    vi.useFakeTimers()
    let calls = 0
    const stop = pollRefactorJob({
      jobId: 'job-1',
      intervalMs: 1000,
      fetchStatus: async () => {
        calls += 1
        return { state: 'done', progress: '', warnings: [] }
      },
      onStatus: () => {}
    })
    await vi.advanceTimersByTimeAsync(5000)
    stop()
    expect(calls).toBe(1)
  })

  it('stops the schedule when the caller stops it while the job is still running', async () => {
    vi.useFakeTimers()
    let calls = 0
    const stop = pollRefactorJob({
      jobId: 'job-1',
      intervalMs: 1000,
      fetchStatus: async () => {
        calls += 1
        return { state: 'running', progress: '', warnings: [] }
      },
      onStatus: () => {}
    })
    await vi.advanceTimersByTimeAsync(1)
    expect(vi.getTimerCount()).toBe(1)

    stop()

    // Why: the pending timer is the poll's life, so a cleared one means the poll is over.
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls).toBe(1)
  })

  it('does not poll again when the caller stops it while a poll is in flight', async () => {
    vi.useFakeTimers()
    const pending = Promise.withResolvers<RefactorStatusResult>()
    let calls = 0
    const seen: string[] = []
    const stop = pollRefactorJob({
      jobId: 'job-1',
      intervalMs: 1000,
      fetchStatus: async () => {
        calls += 1
        return pending.promise
      },
      onStatus: (status) => seen.push(status.state)
    })
    await vi.advanceTimersByTimeAsync(1)

    stop()
    pending.resolve({ state: 'running', progress: '', warnings: [] })
    await vi.advanceTimersByTimeAsync(5000)

    expect(calls).toBe(1)
    // Why: a closed tab must not be told about a job it no longer watches.
    expect(seen).toEqual([])
  })
})
