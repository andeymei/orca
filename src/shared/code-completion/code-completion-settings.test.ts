import { describe, expect, it } from 'vitest'
import {
  getDefaultCodeCompletionSettings,
  normalizeCodeCompletionSettings
} from './code-completion-settings'

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

const DEFAULT_SETTINGS = {
  enabled: true,
  protocol: 'anthropic-messages',
  baseUrl: '',
  model: '',
  triggerDelayMs: 500,
  autoImport: true,
  enabledExtensions: DEFAULT_EXTENSIONS
}

describe('code completion settings', () => {
  it('defaults to enabled with no endpoint configured', () => {
    expect(getDefaultCodeCompletionSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('normalizes an unknown protocol back to the default', () => {
    const normalized = normalizeCodeCompletionSettings({ protocol: 'gemini-chat' })

    expect(normalized.protocol).toBe('anthropic-messages')
  })

  it('normalizes a negative trigger delay to the default', () => {
    const normalized = normalizeCodeCompletionSettings({ triggerDelayMs: -100 })

    expect(normalized.triggerDelayMs).toBe(500)
  })

  it('keeps a per-extension list', () => {
    const normalized = normalizeCodeCompletionSettings({ enabledExtensions: ['ts', 'go'] })

    expect(normalized.enabledExtensions).toEqual(['ts', 'go'])
  })

  it('returns the defaults for a value that is not an object', () => {
    expect(normalizeCodeCompletionSettings('nonsense')).toEqual(DEFAULT_SETTINGS)
    expect(normalizeCodeCompletionSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeCodeCompletionSettings(['ts'])).toEqual(DEFAULT_SETTINGS)
  })

  it('falls back per field when a value has the wrong type', () => {
    const normalized = normalizeCodeCompletionSettings({
      enabled: 'yes',
      baseUrl: 42,
      model: null,
      autoImport: 'no',
      enabledExtensions: 'ts'
    })

    expect(normalized.enabled).toBe(true)
    expect(normalized.baseUrl).toBe('')
    expect(normalized.model).toBe('')
    expect(normalized.autoImport).toBe(true)
    expect(normalized.enabledExtensions).toEqual(DEFAULT_EXTENSIONS)
  })

  it('caps the trigger delay at the ceiling', () => {
    expect(normalizeCodeCompletionSettings({ triggerDelayMs: 99_999 }).triggerDelayMs).toBe(5000)
  })

  it('hands out a fresh extension list per call', () => {
    const first = getDefaultCodeCompletionSettings()
    first.enabledExtensions.push('zz')

    expect(getDefaultCodeCompletionSettings().enabledExtensions).toEqual(DEFAULT_EXTENSIONS)
  })
})
