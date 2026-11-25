import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodePath from 'node:path'
import { _resetSecretStoreForTests, setSecretStore } from '../../shared/secure-storage/secret-store'
import type * as CodeCompletionApiKeyStore from './code-completion-api-key-store'

const safeStorageMock = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) => Buffer.from(value)),
  decryptString: vi.fn((value: Buffer) => value.toString('utf8'))
}))

beforeEach(() => setSecretStore({ ...safeStorageMock, describeProtectionGap: () => null }))

const files = new Map<string, Buffer>()
const rmMock = vi.fn()

vi.mock('node:fs/promises', () => ({
  readFile: async (path: string) => {
    const contents = files.get(path)
    if (!contents) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`)
    }
    return contents
  },
  rm: rmMock
}))

vi.mock('node:os', () => ({
  homedir: () => '/home/test'
}))

vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof NodePath>()
  return { ...actual, join: (...parts: string[]) => parts.join('/') }
})

vi.mock('../credentials/credential-file-io', () => ({
  credentialFileExists: async (path: string) => files.has(path),
  hardenCredentialFile: async () => {},
  inCredentialFileOrder: async (_path: string, run: () => Promise<unknown>) => run(),
  stageCredentialFile: async (path: string, data: string | Buffer) => {
    files.set(path, Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'))
    return true
  }
}))

const storePath = '/home/test/.orca/code-completion-api-key.enc'

async function loadStore(): Promise<typeof CodeCompletionApiKeyStore> {
  vi.resetModules()
  return await import('./code-completion-api-key-store')
}

describe('code completion api key store', () => {
  beforeEach(() => {
    files.clear()
    rmMock.mockImplementation(async (path: string) => {
      files.delete(path)
    })
    rmMock.mockClear()
    safeStorageMock.isEncryptionAvailable.mockReset()
    safeStorageMock.encryptString.mockReset()
    safeStorageMock.decryptString.mockReset()
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from(value))
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString('utf8'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    _resetSecretStoreForTests()
  })

  it('reports no key before one is saved', async () => {
    const store = await loadStore()

    await expect(store.hasCodeCompletionApiKey()).resolves.toBe(false)
    await expect(store.readCodeCompletionApiKey()).resolves.toBeNull()
    await expect(store.getCodeCompletionApiKeyProtection()).resolves.toBeNull()
    expect(files.size).toBe(0)
  })

  it('saves and reads a key back', async () => {
    const store = await loadStore()

    await store.saveCodeCompletionApiKey('secret-key')

    expect(files.get(storePath)?.toString('utf8')).toContain(
      'orca-code-completion-api-key:v1:encrypted:'
    )
    const reloaded = await loadStore()
    await expect(reloaded.readCodeCompletionApiKey()).resolves.toBe('secret-key')
    await expect(reloaded.hasCodeCompletionApiKey()).resolves.toBe(true)
    await expect(reloaded.getCodeCompletionApiKeyProtection()).resolves.toBe('sealed')
  })

  it('rejects an empty key', async () => {
    const store = await loadStore()

    await expect(store.saveCodeCompletionApiKey('   ')).rejects.toThrow(
      'Code completion API key is required'
    )
    expect(files.size).toBe(0)
  })

  it('reports a plaintext key as unsealed when the keyring is unavailable', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const store = await loadStore()

    await store.saveCodeCompletionApiKey('secret-key')

    const reloaded = await loadStore()
    await expect(reloaded.getCodeCompletionApiKeyProtection()).resolves.toBe('plaintext')
  })

  it('clears a saved key', async () => {
    const store = await loadStore()
    await store.saveCodeCompletionApiKey('secret-key')

    await store.clearCodeCompletionApiKey()

    expect(rmMock).toHaveBeenCalledWith(storePath, { force: true })
    const reloaded = await loadStore()
    await expect(reloaded.hasCodeCompletionApiKey()).resolves.toBe(false)
    await expect(reloaded.readCodeCompletionApiKey()).resolves.toBeNull()
  })
})
