import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearCodeCompletionApiKeyCredential,
  getCodeCompletionCredentialStatus,
  saveCodeCompletionApiKeyCredential
} from './code-completion-credential-commands'

const { storeState, storeMocks } = vi.hoisted(() => {
  const state = { saved: false, protection: null as 'sealed' | 'plaintext' | null }
  return {
    storeState: state,
    storeMocks: {
      hasCodeCompletionApiKey: vi.fn(() => state.saved),
      readCodeCompletionApiKey: vi.fn(() => (state.saved ? 'secret-key' : null)),
      saveCodeCompletionApiKey: vi.fn((key: string) => {
        state.saved = key.length > 0
        state.protection = 'sealed'
      }),
      clearCodeCompletionApiKey: vi.fn(() => {
        state.saved = false
        state.protection = null
      }),
      getCodeCompletionApiKeyProtection: vi.fn(() => state.protection),
      codeCompletionApiKeyEnvelopeFile: vi.fn(() => ({
        path: '/home/test/.orca/code-completion-api-key.enc',
        envelopePrefix: 'orca-code-completion-api-key:v1:'
      }))
    }
  }
})

vi.mock('./code-completion-api-key-store', () => storeMocks)

describe('code completion credential commands', () => {
  beforeEach(() => {
    storeState.saved = false
    storeState.protection = null
    for (const mock of Object.values(storeMocks)) {
      mock.mockClear()
    }
  })

  it('reports no key when none is saved', () => {
    expect(getCodeCompletionCredentialStatus()).toEqual({ configured: false, protection: null })
  })

  it('reports the key as configured after a save', () => {
    const status = saveCodeCompletionApiKeyCredential('secret-key')

    expect(storeMocks.saveCodeCompletionApiKey).toHaveBeenCalledWith('secret-key')
    expect(status).toEqual({ configured: true, protection: 'sealed' })
  })

  it('rejects a key that is not a string', () => {
    expect(() => saveCodeCompletionApiKeyCredential(42)).toThrow('must be a string')
    expect(storeMocks.saveCodeCompletionApiKey).not.toHaveBeenCalled()
  })

  it('rejects a key with an interior newline', () => {
    expect(() => saveCodeCompletionApiKeyCredential('abc\ndef')).toThrow('must be a single line')
    expect(() => saveCodeCompletionApiKeyCredential('abc\rdef')).toThrow('must be a single line')
    expect(storeMocks.saveCodeCompletionApiKey).not.toHaveBeenCalled()
  })

  it('clears the key', () => {
    saveCodeCompletionApiKeyCredential('secret-key')

    const status = clearCodeCompletionApiKeyCredential()

    expect(storeMocks.clearCodeCompletionApiKey).toHaveBeenCalled()
    expect(status).toEqual({ configured: false, protection: null })
  })
})
