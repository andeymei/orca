import {
  closeTestStores,
  testState,
  createStore,
  writeDataFile
} from '../../persistence-test-harness'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => {
      const decoded = ciphertext.toString('utf-8')
      if (!decoded.startsWith('encrypted:')) {
        throw new Error('invalid ciphertext')
      }
      return decoded.slice('encrypted:'.length)
    }
  }
}))
vi.mock('../../../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../../telemetry/cohort-classifier', () => ({ nth_repo_added: 2 }))

function writeSettings(settings: Record<string, unknown>): void {
  writeDataFile({
    schemaVersion: 1,
    repos: [],
    worktreeMeta: {},
    settings,
    ui: {},
    githubCache: { pr: {}, issue: {} },
    workspaceSession: {}
  })
}

const DEFAULT_EXTENSIONS = [
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'go',
  'rs',
  'java',
  'rb',
  'php',
  'cs',
  'swift',
  'kt',
  'scala',
  'c',
  'h',
  'cpp',
  'hpp',
  'vue',
  'svelte'
]

// A profile file can be hand-edited or imported from elsewhere, so the loader normalizes the
// block it reads rather than trusting it.
describe('code completion settings on load', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-test-'))
  })

  afterEach(async () => {
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('normalizes a malformed block a profile file carried', async () => {
    writeSettings({
      codeCompletion: { enabled: true, protocol: 'gemini-chat', triggerDelayMs: 'soon' }
    })

    const store = await createStore()

    expect(store.getSettings().codeCompletion).toEqual({
      enabled: true,
      protocol: 'anthropic-messages',
      baseUrl: '',
      model: '',
      triggerDelayMs: 500,
      autoImport: true,
      enabledExtensions: DEFAULT_EXTENSIONS
    })
  })

  it('keeps a block that names the protocol, endpoint and model the user picked', async () => {
    writeSettings({
      codeCompletion: {
        enabled: false,
        protocol: 'openai-chat',
        baseUrl: 'https://api.test',
        model: 'a-model',
        triggerDelayMs: 250,
        autoImport: false,
        enabledExtensions: ['ts']
      }
    })

    const store = await createStore()

    expect(store.getSettings().codeCompletion).toEqual({
      enabled: false,
      protocol: 'openai-chat',
      baseUrl: 'https://api.test',
      model: 'a-model',
      triggerDelayMs: 250,
      autoImport: false,
      enabledExtensions: ['ts']
    })
  })
})
