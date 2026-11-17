import type { NesBackendId } from './code-completion-types'

/** The protocols the user can pick from; the type stays the source of truth. */
const NES_BACKEND_IDS = [
  'anthropic-messages',
  'openai-chat',
  'openai-completions-fim'
] as const satisfies readonly NesBackendId[]

const DEFAULT_TRIGGER_DELAY_MS = 500
const MAX_TRIGGER_DELAY_MS = 5000

const DEFAULT_ENABLED_EXTENSIONS = [
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
] as const

export type CodeCompletionSettings = {
  enabled: boolean
  protocol: NesBackendId
  baseUrl: string
  model: string
  triggerDelayMs: number
  autoImport: boolean
  enabledExtensions: string[]
}

export type CodeCompletionSettingsHolder = {
  /** Optional so an existing profile needs no migration. */
  codeCompletion?: CodeCompletionSettings
}

export function getDefaultCodeCompletionSettings(): CodeCompletionSettings {
  return {
    enabled: true,
    protocol: 'anthropic-messages',
    baseUrl: '',
    model: '',
    triggerDelayMs: DEFAULT_TRIGGER_DELAY_MS,
    autoImport: true,
    enabledExtensions: [...DEFAULT_ENABLED_EXTENSIONS]
  }
}

export function normalizeCodeCompletionSettings(value: unknown): CodeCompletionSettings {
  const defaults = getDefaultCodeCompletionSettings()
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return defaults
  }
  const record = value as Record<string, unknown>
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : defaults.enabled,
    protocol: isNesBackendId(record.protocol) ? record.protocol : defaults.protocol,
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : defaults.baseUrl,
    model: typeof record.model === 'string' ? record.model : defaults.model,
    triggerDelayMs: normalizeTriggerDelay(record.triggerDelayMs, defaults.triggerDelayMs),
    autoImport: typeof record.autoImport === 'boolean' ? record.autoImport : defaults.autoImport,
    enabledExtensions: normalizeEnabledExtensions(
      record.enabledExtensions,
      defaults.enabledExtensions
    )
  }
}

function isNesBackendId(value: unknown): value is NesBackendId {
  return typeof value === 'string' && NES_BACKEND_IDS.some((id) => id === value)
}

function normalizeTriggerDelay(value: unknown, fallback: number): number {
  // Why: a negative wait would ask on every keystroke, so it takes the default; a long wait is capped.
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback
  }
  return Math.min(value, MAX_TRIGGER_DELAY_MS)
}

function normalizeEnabledExtensions(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback
  }
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
}
