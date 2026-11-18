import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installApi } from './web-preload-api-test-harness'

describe('web code completion credential API', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock('./web-runtime-client')
  })

  it('reports no key and refuses a save instead of silently succeeding', async () => {
    const { api } = await installApi()

    expect(await api.codeCompletion.getStatus()).toEqual({ configured: false, protection: null })
    await expect(api.codeCompletion.saveApiKey('fake-key')).rejects.toThrow(
      'only be changed in the desktop app'
    )
    expect(await api.codeCompletion.clearApiKey()).toEqual({ configured: false, protection: null })
  })
})
