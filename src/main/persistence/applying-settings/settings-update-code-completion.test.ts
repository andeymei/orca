import { describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { getDefaultPersistedState } from '../../../shared/constants'
import { updateSettings, type SettingsMutationOperations } from './settings-update'

function makeOperations(): SettingsMutationOperations {
  return {
    state: getDefaultPersistedState(tmpdir()),
    bumpLocalWorktreeScanGeneration: vi.fn(),
    removeRetainedBlob: vi.fn(),
    scheduleSave: vi.fn(),
    notifySettingsChanged: vi.fn()
  }
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

// Every writer — the renderer's IPC, the runtime RPC, the CLI, plugin hosts — reaches the store
// through this boundary, so the block is normalized here.
describe('updateSettings codeCompletion', () => {
  it('normalizes a malformed block instead of storing it as written', () => {
    const operations = makeOperations()

    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the block is deliberately malformed, and repairing it is what this case is about.
    updateSettings(operations, {
      codeCompletion: { enabled: 'yes', triggerDelayMs: -100 }
    } as never)

    expect(operations.state.settings.codeCompletion).toEqual({
      enabled: true,
      protocol: 'anthropic-messages',
      baseUrl: '',
      model: '',
      triggerDelayMs: 500,
      autoImport: true,
      enabledExtensions: DEFAULT_EXTENSIONS
    })
  })

  it('keeps a block that names the protocol, endpoint and model the user picked', () => {
    const operations = makeOperations()

    updateSettings(operations, {
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

    expect(operations.state.settings.codeCompletion).toEqual({
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
