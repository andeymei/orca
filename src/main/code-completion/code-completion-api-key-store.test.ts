import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetSecretStoreForTests, setSecretStore } from '../../shared/secret-store'
import type * as CodeCompletionApiKeyStore from './code-completion-api-key-store'

const safeStorageMock = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) => Buffer.from(value)),
  decryptString: vi.fn((value: Buffer) => value.toString('utf8'))
}))

beforeEach(() => setSecretStore({ ...safeStorageMock, describeProtectionGap: () => null }))

const files = new Map<string, Buffer>()
const existsSyncMock = vi.fn()
const readFileSyncMock = vi.fn()
const rmSyncMock = vi.fn()
const hardenExistingSecureFileMock = vi.fn()
const writeSecureFileMock = vi.fn()
const homedirMock = vi.fn(() => '/home/test')

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
  readFileSync: readFileSyncMock,
  rmSync: rmSyncMock
}))

vi.mock('node:os', () => ({
  homedir: homedirMock
}))

vi.mock('node:path', () => ({
  join: (...parts: string[]) => parts.join('/')
}))

vi.mock('../../shared/secure-storage/secure-file', () => ({
  hardenExistingSecureFile: hardenExistingSecureFileMock,
  writeSecureFile: writeSecureFileMock,
  isUnreadableError: () => false
}))

const storePath = '/home/test/.orca/code-completion-api-key.enc'

async function loadStore(): Promise<typeof CodeCompletionApiKeyStore> {
  vi.resetModules()
  return await import('./code-completion-api-key-store')
}

describe('code completion api key store', () => {
  beforeEach(() => {
    files.clear()
    existsSyncMock.mockImplementation((path: string) => files.has(path))
    readFileSyncMock.mockImplementation((path: string) => files.get(path) ?? Buffer.alloc(0))
    rmSyncMock.mockImplementation((path: string) => {
      files.delete(path)
    })
    writeSecureFileMock.mockImplementation((path: string, contents: string) => {
      files.set(path, Buffer.from(contents, 'utf8'))
      return true
    })
    existsSyncMock.mockClear()
    readFileSyncMock.mockClear()
    rmSyncMock.mockClear()
    hardenExistingSecureFileMock.mockClear()
    writeSecureFileMock.mockClear()
    safeStorageMock.isEncryptionAvailable.mockReset()
    safeStorageMock.encryptString.mockReset()
    safeStorageMock.decryptString.mockReset()
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from(value))
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString('utf8'))
    homedirMock.mockReturnValue('/home/test')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    _resetSecretStoreForTests()
  })

  it('reports no key before one is saved', async () => {
    const store = await loadStore()

    expect(store.hasCodeCompletionApiKey()).toBe(false)
    expect(store.readCodeCompletionApiKey()).toBeNull()
    expect(store.getCodeCompletionApiKeyProtection()).toBeNull()
    expect(files.size).toBe(0)
  })

  it('saves and reads a key back', async () => {
    const store = await loadStore()

    store.saveCodeCompletionApiKey('secret-key')

    expect(writeSecureFileMock).toHaveBeenCalledWith(
      storePath,
      expect.stringContaining('orca-code-completion-api-key:v1:encrypted:'),
      expect.anything()
    )
    const reloaded = await loadStore()
    expect(reloaded.readCodeCompletionApiKey()).toBe('secret-key')
    expect(reloaded.hasCodeCompletionApiKey()).toBe(true)
    expect(reloaded.getCodeCompletionApiKeyProtection()).toBe('sealed')
  })

  it('rejects an empty key', async () => {
    const store = await loadStore()

    expect(() => store.saveCodeCompletionApiKey('   ')).toThrow(
      'Code completion API key is required'
    )
    expect(writeSecureFileMock).not.toHaveBeenCalled()
  })

  it('reports a plaintext key as unsealed when the keyring is unavailable', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const store = await loadStore()

    store.saveCodeCompletionApiKey('secret-key')

    const reloaded = await loadStore()
    expect(reloaded.getCodeCompletionApiKeyProtection()).toBe('plaintext')
  })

  it('clears a saved key', async () => {
    const store = await loadStore()
    store.saveCodeCompletionApiKey('secret-key')

    store.clearCodeCompletionApiKey()

    expect(rmSyncMock).toHaveBeenCalledWith(storePath, { force: true })
    const reloaded = await loadStore()
    expect(reloaded.hasCodeCompletionApiKey()).toBe(false)
    expect(reloaded.readCodeCompletionApiKey()).toBeNull()
  })
})
