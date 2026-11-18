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
})
