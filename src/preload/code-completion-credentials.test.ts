import { describe, expect, it, vi } from 'vitest'
import { codeCompletionApi } from './api/code-completion-bridge'

const invoke = vi.hoisted(() => vi.fn(async () => ({ configured: true, protection: null })))
vi.mock('electron', () => ({ ipcRenderer: { invoke } }))

describe('Code completion credential bridge', () => {
  it('exposes only status and write operations', async () => {
    expect(await codeCompletionApi.getStatus()).toEqual({ configured: true, protection: null })
    await codeCompletionApi.saveApiKey('fake-key')
    await codeCompletionApi.clearApiKey()
    expect(invoke.mock.calls).toEqual([
      ['codeCompletion:getCredentialStatus'],
      ['codeCompletion:saveApiKey', 'fake-key'],
      ['codeCompletion:clearApiKey']
    ])
    expect(Object.keys(codeCompletionApi)).toEqual(['getStatus', 'saveApiKey', 'clearApiKey'])
  })
})
