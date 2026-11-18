import { describe, expect, it, vi } from 'vitest'
import { CODE_COMPLETION_CREDENTIAL_CHANNELS } from '../shared/code-completion/code-completion-credential-channels'
import { codeCompletionApi } from './api/code-completion-bridge'

const invoke = vi.hoisted(() => vi.fn(async () => ({ configured: true, protection: null })))
vi.mock('electron', () => ({ ipcRenderer: { invoke } }))

describe('Code completion credential bridge', () => {
  it('exposes only status and write operations', async () => {
    expect(await codeCompletionApi.getStatus()).toEqual({ configured: true, protection: null })
    await codeCompletionApi.saveApiKey('fake-key')
    await codeCompletionApi.clearApiKey()
    expect(invoke.mock.calls).toEqual([
      [CODE_COMPLETION_CREDENTIAL_CHANNELS.getCredentialStatus],
      [CODE_COMPLETION_CREDENTIAL_CHANNELS.saveApiKey, 'fake-key'],
      [CODE_COMPLETION_CREDENTIAL_CHANNELS.clearApiKey]
    ])
    expect(Object.keys(codeCompletionApi)).toEqual(['getStatus', 'saveApiKey', 'clearApiKey'])
  })

  it('pins the channel names the main-process handlers register', () => {
    expect(CODE_COMPLETION_CREDENTIAL_CHANNELS).toEqual({
      getCredentialStatus: 'codeCompletion:getCredentialStatus',
      saveApiKey: 'codeCompletion:saveApiKey',
      clearApiKey: 'codeCompletion:clearApiKey'
    })
  })
})
