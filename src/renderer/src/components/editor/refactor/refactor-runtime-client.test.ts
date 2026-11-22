import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installRuntimeFileClientEnvironment,
  runtimeCall,
  runtimeCancelCall
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
  vi.mocked(console.error).mockClear()
})

function answered(result: unknown): unknown {
  return { id: 'rpc-1', ok: true, result, _meta: { runtimeId: 'runtime-1' } }
}

describe('the refactor runtime client', () => {
  it('sends the workspace as a runtime selector', async () => {
    runtimeCall.mockResolvedValue(answered({ jobId: 'job-1' }))

    const outcome = await proposeRefactor({
      worktreeId: 'wt-1',
      relativePath: 'src/app.ts',
      content: 'const a = 1',
      instruction: 'extract the validation'
    })

    expect(outcome).toEqual({ jobId: 'job-1' })
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
    ).toEqual({ failure: 'unreachable' })
  })

  it('carries the reason of a refusal, so the user reads why', async () => {
    runtimeCall.mockResolvedValue({
      id: 'rpc-1',
      ok: false,
      error: { code: 'runtime_error', message: '远程主机上的重构暂不支持' },
      _meta: { runtimeId: 'runtime-1' }
    })

    expect(
      await proposeRefactor({ worktreeId: 'wt-1', relativePath: 'src/app.ts', content: '' })
    ).toEqual({ failure: 'refused', reason: '远程主机上的重构暂不支持' })
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

    expect(await request).toEqual({ failure: 'unreachable' })
    // Why: a request nobody waits for must stop working in the runtime.
    expect(runtimeCancelCall).toHaveBeenCalled()
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

  it('answers how far a running job has come', async () => {
    runtimeCall.mockResolvedValue(answered({ state: 'running', progress: 'halfway', warnings: [] }))

    expect(await fetchRefactorStatus('job-1')).toEqual({
      state: 'running',
      progress: 'halfway',
      warnings: []
    })
  })

  it('fails the apply when the write does not happen', async () => {
    runtimeCall.mockRejectedValue(new Error('the disk is full'))

    await expect(applyRefactor('job-1', ['hunk-1'])).rejects.toThrow('the disk is full')
  })

  it('answers the files the write touched', async () => {
    runtimeCall.mockResolvedValue(
      answered({ applied: [{ path: 'src/app.ts', hunksApplied: 2 }], refusals: [] })
    )

    expect(await applyRefactor('job-1', ['hunk-1'])).toEqual({
      applied: [{ path: 'src/app.ts', hunksApplied: 2 }],
      refusals: []
    })
    expect(runtimeCall).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'refactor.apply',
        params: { jobId: 'job-1', acceptedHunkIds: ['hunk-1'] }
      })
    )
  })

  it('keeps the job when the discard fails', async () => {
    runtimeCall.mockRejectedValue(new Error('the runtime is gone'))

    expect(await discardRefactor('job-1')).toBe(false)
  })

  it('drops the job when the runtime discards it', async () => {
    runtimeCall.mockResolvedValue(answered({ discarded: true }))

    expect(await discardRefactor('job-1')).toBe(true)
  })
})
