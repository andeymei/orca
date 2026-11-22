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
})
