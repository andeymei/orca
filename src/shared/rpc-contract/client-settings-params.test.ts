// The settings update schema is strict, so the completion block needs its own field to be saved.

import { describe, expect, it } from 'vitest'
import { SettingsUpdate } from './client-settings-params'

describe('settings.update params', () => {
  it('accepts the code completion block and normalizes it', () => {
    const parsed = SettingsUpdate.parse({
      codeCompletion: { enabled: false, protocol: 'openai-chat', triggerDelayMs: 120 }
    })

    expect(parsed.codeCompletion).toEqual({
      enabled: false,
      protocol: 'openai-chat',
      responseMode: 'inline',
      baseUrl: '',
      model: '',
      triggerDelayMs: 120,
      autoImport: true,
      contextPrefixChars: 6000,
      contextSuffixChars: 2000,
      displayDeadlineMs: 4000,
      enabledExtensions: [
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
    })
  })

  it('leaves the block absent when the update does not carry it', () => {
    expect(SettingsUpdate.parse({}).codeCompletion).toBeUndefined()
  })
})
