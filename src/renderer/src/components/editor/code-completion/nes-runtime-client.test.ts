import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installRuntimeFileClientEnvironment,
  runtimeCall
} from '@/runtime/files/runtime-file-client-test-harness'
import type { NesRequest } from '../../../../../shared/code-completion/code-completion-types'
import { requestNesPlan } from './nes-runtime-client'

installRuntimeFileClientEnvironment()

const REQUEST: NesRequest = {
  filePath: '/repo/src/app.ts',
  relativePath: 'src/app.ts',
  languageId: 'typescript',
  prefix: 'const a = ',
  suffix: '',
  prefixStartLine: 1,
  cursorLine: 1,
  cursorColumn: 10,
  relatedFiles: [],
  recentEdits: []
}

const EDIT = {
  id: 'e1',
  path: '/repo/src/app.ts',
  kind: 'insert',
  range: { startLine: 1, startColumn: 10, endLine: 1, endColumn: 10 },
  originalText: '',
  text: '1',
  label: 'add the value'
}

function answered(plan: unknown): unknown {
  return { id: 'rpc-1', ok: true, result: { plan }, _meta: { runtimeId: 'runtime-1' } }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.mocked(console.error).mockClear()
})

describe('requestNesPlan', () => {
  it('returns the plan the runtime answered', async () => {
    runtimeCall.mockResolvedValue(answered({ edits: [EDIT] }))

    const plan = await requestNesPlan(REQUEST)

    expect(plan?.edits).toEqual([EDIT])
    expect(runtimeCall).toHaveBeenCalledWith({
      method: 'codeCompletion.plan',
      params: REQUEST
    })
  })

  it('returns null when the runtime answers no plan', async () => {
    runtimeCall.mockResolvedValue(answered(null))

    expect(await requestNesPlan(REQUEST)).toBeNull()
  })

  it('returns null when the payload does not parse', async () => {
    runtimeCall.mockResolvedValue(answered({ edits: 'not a plan' }))

    expect(await requestNesPlan(REQUEST)).toBeNull()
  })

  it('returns null when the runtime answers an error', async () => {
    runtimeCall.mockResolvedValue({
      id: 'rpc-1',
      ok: false,
      error: { code: 'internal', message: 'the key file cannot be read' },
      _meta: { runtimeId: 'runtime-1' }
    })

    expect(await requestNesPlan(REQUEST)).toBeNull()
  })

  it('returns null when the call is rejected', async () => {
    runtimeCall.mockRejectedValue(new Error('the runtime is gone'))

    expect(await requestNesPlan(REQUEST)).toBeNull()
  })

  it('returns null when the call does not answer in time', async () => {
    runtimeCall.mockReturnValue(new Promise(() => undefined))

    expect(await requestNesPlan(REQUEST, { timeoutMs: 5 })).toBeNull()
  })

  it('returns null without logging when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    expect(await requestNesPlan(REQUEST, { signal: controller.signal })).toBeNull()
    expect(runtimeCall).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
  })

  it('returns null without logging when the call is aborted mid-flight', async () => {
    const controller = new AbortController()
    runtimeCall.mockReturnValue(new Promise(() => undefined))

    const request = requestNesPlan(REQUEST, { signal: controller.signal })
    controller.abort()

    expect(await request).toBeNull()
    expect(console.error).not.toHaveBeenCalled()
  })

  it('logs a genuine failure with the name of the error only', async () => {
    runtimeCall.mockRejectedValue(new Error('the key file cannot be read'))

    expect(await requestNesPlan(REQUEST)).toBeNull()
    expect(console.error).toHaveBeenCalledWith('[code-completion] The plan request failed.', {
      error: 'Error'
    })
  })
})
