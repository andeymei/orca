import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installRuntimeFileClientEnvironment,
  runtimeCall
} from '@/runtime/files/runtime-file-client-test-harness'
import {
  applyRefactor,
  discardRefactor,
  fetchRefactorPlan,
  fetchRefactorStatus,
  proposeRefactor
} from './refactor-runtime-client'

installRuntimeFileClientEnvironment()

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

function answered(result: unknown): unknown {
  return { id: 'rpc-1', ok: true, result, _meta: { runtimeId: 'runtime-1' } }
}

describe('the refactor runtime client', () => {
  it('sends the workspace as a runtime selector', async () => {
    runtimeCall.mockResolvedValue(answered({ jobId: 'job-1' }))

    const jobId = await proposeRefactor({
      worktreeId: 'wt-1',
      relativePath: 'src/app.ts',
      content: 'const a = 1',
      instruction: 'extract the validation'
    })

    expect(jobId).toBe('job-1')
    expect(runtimeCall).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'refactor.propose',
        params: {
          worktree: 'id:wt-1',
          relativePath: 'src/app.ts',
          content: 'const a = 1',
          instruction: 'extract the validation'
        }
      })
    )
  })

  it('answers no job when the propose fails', async () => {
    runtimeCall.mockRejectedValue(new Error('the runtime is gone'))

    expect(
      await proposeRefactor({ worktreeId: 'wt-1', relativePath: 'src/app.ts', content: '' })
    ).toBeNull()
  })

  it('answers no job when the runtime does not answer in time', async () => {
    vi.useFakeTimers()
    runtimeCall.mockReturnValue(new Promise(() => undefined))

    const request = proposeRefactor({
      worktreeId: 'wt-1',
      relativePath: 'src/app.ts',
      content: ''
    })
    await vi.advanceTimersByTimeAsync(120_000)

    expect(await request).toBeNull()
  })

  it('answers the plan of a finished job', async () => {
    runtimeCall.mockResolvedValue(
      answered({ plan: { jobId: 'job-1', sourcePath: 'src/app.ts', proposals: [] } })
    )

    expect(await fetchRefactorPlan('job-1')).toEqual({
      jobId: 'job-1',
      sourcePath: 'src/app.ts',
      proposals: []
    })
  })

  it('answers no plan when the payload does not parse', async () => {
    runtimeCall.mockResolvedValue(answered({ plan: { jobId: 'job-1' } }))

    expect(await fetchRefactorPlan('job-1')).toBeNull()
  })

  it('fails the status when the runtime does not answer', async () => {
    runtimeCall.mockRejectedValue(new Error('the runtime is gone'))

    await expect(fetchRefactorStatus('job-1')).rejects.toThrow('the runtime is gone')
  })

  it('fails the apply when the write does not happen', async () => {
    runtimeCall.mockRejectedValue(new Error('the disk is full'))

    await expect(applyRefactor('job-1', ['hunk-1'])).rejects.toThrow('the disk is full')
  })

  it('keeps the job when the discard fails', async () => {
    runtimeCall.mockRejectedValue(new Error('the runtime is gone'))

    expect(await discardRefactor('job-1')).toBe(false)
  })
})
