import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installRuntimeFileClientEnvironment,
  runtimeCall,
  runtimeCancelCall,
  runtimeEnvironmentSubscribe
} from '@/runtime/files/runtime-file-client-test-harness'
import {
  applyRefactor,
  discardRefactor,
  fetchRefactorPlan,
  fetchRefactorStatus,
  proposeRefactor,
  RefactorApplyTimeoutError
} from './refactor-runtime-client'
import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'

installRuntimeFileClientEnvironment()

/** The runtime that owns a workspace of this machine. */
const LOCAL_TARGET: RuntimeClientTarget = { kind: 'local' }

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

/** The id the transport gave a call; the main side keys a pending call by it. */
function requestIdOf(request: unknown): string | undefined {
  if (typeof request !== 'object' || request === null || !('requestId' in request)) {
    return undefined
  }
  const { requestId } = request
  return typeof requestId === 'string' ? requestId : undefined
}

/** The environment transport answers over a subscription, not a call. */
function environmentAnswers(response: unknown): void {
  runtimeEnvironmentSubscribe.mockImplementation(
    (_args: unknown, callbacks: { onResponse: (response: unknown) => void }) => {
      callbacks.onResponse(response)
      return Promise.resolve({ unsubscribe: () => undefined })
    }
  )
}

describe('the refactor runtime client', () => {
  it('sends the workspace as a runtime selector', async () => {
    runtimeCall.mockResolvedValue(answered({ jobId: 'job-1' }))

    const outcome = await proposeRefactor({
      target: LOCAL_TARGET,
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

  it('sends the propose to the runtime that owns the workspace', async () => {
    environmentAnswers(answered({ jobId: 'job-1' }))

    const outcome = await proposeRefactor({
      target: { kind: 'environment', environmentId: 'env-1' },
      worktreeId: 'wt-1',
      relativePath: 'src/app.ts',
      content: 'const a = 1'
    })

    expect(outcome).toEqual({ jobId: 'job-1' })
    expect(runtimeEnvironmentSubscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'refactor.propose',
        params: {
          worktree: 'id:wt-1',
          relativePath: 'src/app.ts',
          content: 'const a = 1'
        }
      }),
      expect.anything()
    )
    // Why: this app's runtime holds no row for another runtime's workspace and answers
    // `selector_not_found` for it, which says nothing about the workspace.
    expect(runtimeCall).not.toHaveBeenCalled()
  })

  it('says the owning server is too old when it does not know the method', async () => {
    environmentAnswers({
      id: 'rpc-1',
      ok: false,
      error: { code: 'method_not_found', message: 'Unknown method: refactor.propose' },
      _meta: { runtimeId: 'remote-runtime' }
    })

    const outcome = await proposeRefactor({
      target: { kind: 'environment', environmentId: 'env-1' },
      worktreeId: 'wt-1',
      relativePath: 'src/app.ts',
      content: ''
    })

    expect(outcome).toEqual({
      failure: 'refused',
      reason: expect.stringContaining('does not support refactoring')
    })
  })

  it('answers no job when the propose fails', async () => {
    runtimeCall.mockRejectedValue(new Error('the runtime is gone'))

    expect(
      await proposeRefactor({
        target: LOCAL_TARGET,
        worktreeId: 'wt-1',
        relativePath: 'src/app.ts',
        content: ''
      })
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
      await proposeRefactor({
        target: LOCAL_TARGET,
        worktreeId: 'wt-1',
        relativePath: 'src/app.ts',
        content: ''
      })
    ).toEqual({ failure: 'refused', reason: '远程主机上的重构暂不支持' })
  })

  it('answers no job when the runtime does not answer in time', async () => {
    vi.useFakeTimers()
    runtimeCall.mockReturnValue(new Promise(() => undefined))

    const request = proposeRefactor({
      target: LOCAL_TARGET,
      worktreeId: 'wt-1',
      relativePath: 'src/app.ts',
      content: ''
    })
    await vi.advanceTimersByTimeAsync(120_000)

    expect(await request).toEqual({ failure: 'unreachable' })
    expect(runtimeCall).toHaveBeenCalled()
    const requestId = requestIdOf(runtimeCall.mock.calls[0][0])
    expect(requestId).toEqual(expect.any(String))
    // Why: a request nobody waits for must stop working in the runtime, and the cancel has to name
    // this call: the main side keys a pending call by its id.
    expect(runtimeCancelCall).toHaveBeenCalledWith(expect.objectContaining({ requestId }))
  })

  it('answers the plan of a finished job', async () => {
    runtimeCall.mockResolvedValue(
      answered({ plan: { jobId: 'job-1', sourcePath: 'src/app.ts', proposals: [] } })
    )

    expect(await fetchRefactorPlan(LOCAL_TARGET, 'job-1')).toEqual({
      jobId: 'job-1',
      sourcePath: 'src/app.ts',
      proposals: []
    })
  })

  it('answers no plan when the payload does not parse', async () => {
    runtimeCall.mockResolvedValue(answered({ plan: { jobId: 'job-1' } }))

    expect(await fetchRefactorPlan(LOCAL_TARGET, 'job-1')).toBeNull()
  })

  it('fails the status when the runtime does not answer', async () => {
    runtimeCall.mockRejectedValue(new Error('the runtime is gone'))

    await expect(fetchRefactorStatus(LOCAL_TARGET, 'job-1')).rejects.toThrow('the runtime is gone')
  })

  it('answers how far a running job has come', async () => {
    runtimeCall.mockResolvedValue(answered({ state: 'running', progress: 'halfway', warnings: [] }))

    expect(await fetchRefactorStatus(LOCAL_TARGET, 'job-1')).toEqual({
      state: 'running',
      progress: 'halfway',
      warnings: []
    })
    expect(runtimeCall).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'refactor.status',
        params: { jobId: 'job-1' }
      })
    )
  })

  it('fails the apply when the write does not happen', async () => {
    runtimeCall.mockRejectedValue(new Error('the disk is full'))

    await expect(applyRefactor(LOCAL_TARGET, 'job-1', ['hunk-1'])).rejects.toThrow(
      'the disk is full'
    )
  })

  it('answers the files the write touched', async () => {
    runtimeCall.mockResolvedValue(
      answered({ applied: [{ path: 'src/app.ts', hunksApplied: 2 }], refusals: [] })
    )

    expect(await applyRefactor(LOCAL_TARGET, 'job-1', ['hunk-1'])).toEqual({
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

  it('raises its own error when the apply runs out of time, because the write may have landed', async () => {
    vi.useFakeTimers()
    runtimeCall.mockReturnValue(new Promise(() => undefined))

    const request = applyRefactor(LOCAL_TARGET, 'job-1', ['hunk-1'])
    // Why the handler comes first: the rejection arrives on the clock, and an unhandled one would
    // fail the run before the assertion reads it.
    const rejection = expect(request).rejects.toBeInstanceOf(RefactorApplyTimeoutError)
    await vi.advanceTimersByTimeAsync(120_000)

    await rejection
  })

  it('keeps the shared timeout message for the requests that only read', async () => {
    vi.useFakeTimers()
    runtimeCall.mockReturnValue(new Promise(() => undefined))

    const request = fetchRefactorStatus(LOCAL_TARGET, 'job-1')
    const rejection = expect(request).rejects.toThrow('The refactoring request timed out.')
    await vi.advanceTimersByTimeAsync(120_000)

    await rejection
    await expect(request).rejects.not.toBeInstanceOf(RefactorApplyTimeoutError)
  })

  it('keeps the job when the discard fails', async () => {
    runtimeCall.mockRejectedValue(new Error('the runtime is gone'))

    expect(await discardRefactor(LOCAL_TARGET, 'job-1')).toBe(false)
  })

  it('drops the job when the runtime discards it', async () => {
    runtimeCall.mockResolvedValue(answered({ discarded: true }))

    expect(await discardRefactor(LOCAL_TARGET, 'job-1')).toBe(true)
    expect(runtimeCall).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'refactor.discard',
        params: { jobId: 'job-1' }
      })
    )
  })

  it('keeps the job when the runtime did not discard it', async () => {
    runtimeCall.mockResolvedValue(answered({ discarded: false }))

    expect(await discardRefactor(LOCAL_TARGET, 'job-1')).toBe(false)
  })
})
