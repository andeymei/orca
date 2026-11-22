import {
  NES_BACKEND_IDS,
  NES_RESPONSE_MODES,
  type NesBackendId,
  type NesResponseMode
} from './code-completion-types'

export const DEFAULT_TRIGGER_DELAY_MS = 500
export const MAX_TRIGGER_DELAY_MS = 5000

/**
 * How much of the file around the cursor is sent.
 *
 * Why so little: every character of it is sent to the provider and waited for, and the model
 * answers the same either way — the suggestion is about the text being typed. These are the
 * numbers a fast completion engine uses.
 */
export const DEFAULT_CONTEXT_PREFIX_CHARS = 6000
export const DEFAULT_CONTEXT_SUFFIX_CHARS = 2000
export const MIN_CONTEXT_CHARS = 200
export const MAX_CONTEXT_CHARS = 40000

/**
 * How long an answer may take before it is no longer worth showing.
 *
 * Why a deadline at all: a suggestion that arrives after the person has moved on is noise, and
 * the request that brings it costs time and tokens. Zero turns the deadline off, which is the
 * right setting for an endpoint that answers slowly and for a person who waits for the answer.
 */
export const DEFAULT_DISPLAY_DEADLINE_MS = 4000
export const MAX_DISPLAY_DEADLINE_MS = 60000

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
  /** The shape the model answers with; the inline mode is the default because it is the one that works. */
  responseMode: NesResponseMode
  baseUrl: string
  model: string
  triggerDelayMs: number
  autoImport: boolean
  enabledExtensions: string[]
  /** How much of the file before the cursor is sent. */
  contextPrefixChars: number
  /** How much of the file after the cursor is sent. */
  contextSuffixChars: number
  /** How long an answer may take before it is no longer shown; zero waits as long as it can. */
  displayDeadlineMs: number
}

export type CodeCompletionSettingsHolder = {
  /** Optional so an existing profile needs no migration. */
  codeCompletion?: CodeCompletionSettings
}

export function getDefaultCodeCompletionSettings(): CodeCompletionSettings {
  return {
    enabled: true,
    protocol: 'anthropic-messages',
    responseMode: 'inline',
    baseUrl: '',
    model: '',
    triggerDelayMs: DEFAULT_TRIGGER_DELAY_MS,
    autoImport: true,
    enabledExtensions: [...DEFAULT_ENABLED_EXTENSIONS],
    contextPrefixChars: DEFAULT_CONTEXT_PREFIX_CHARS,
    contextSuffixChars: DEFAULT_CONTEXT_SUFFIX_CHARS,
    displayDeadlineMs: DEFAULT_DISPLAY_DEADLINE_MS
  }
}

/** An object that carries named fields; the settings block is read field by field off it. */
function isSettingsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeCodeCompletionSettings(value: unknown): CodeCompletionSettings {
  const defaults = getDefaultCodeCompletionSettings()
  if (!isSettingsRecord(value)) {
    return defaults
  }
  const record = value
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : defaults.enabled,
    protocol: isNesBackendId(record.protocol) ? record.protocol : defaults.protocol,
    responseMode: isNesResponseMode(record.responseMode)
      ? record.responseMode
      : defaults.responseMode,
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : defaults.baseUrl,
    model: typeof record.model === 'string' ? record.model : defaults.model,
    triggerDelayMs: normalizeTriggerDelay(record.triggerDelayMs, defaults.triggerDelayMs),
    autoImport: typeof record.autoImport === 'boolean' ? record.autoImport : defaults.autoImport,
    enabledExtensions: normalizeEnabledExtensions(
      record.enabledExtensions,
      defaults.enabledExtensions
    ),
    contextPrefixChars: normalizeContextChars(
      record.contextPrefixChars,
      defaults.contextPrefixChars
    ),
    contextSuffixChars: normalizeContextChars(
      record.contextSuffixChars,
      defaults.contextSuffixChars
    ),
    displayDeadlineMs: normalizeDisplayDeadline(
      record.displayDeadlineMs,
      defaults.displayDeadlineMs
    )
  }
}

/** A deadline that is not a number, or a negative one, falls back to the default. */
function normalizeDisplayDeadline(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback
  }
  return Math.min(value, MAX_DISPLAY_DEADLINE_MS)
}

function isNesBackendId(value: unknown): value is NesBackendId {
  return typeof value === 'string' && NES_BACKEND_IDS.some((id) => id === value)
}

function isNesResponseMode(value: unknown): value is NesResponseMode {
  return typeof value === 'string' && NES_RESPONSE_MODES.some((mode) => mode === value)
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

/** A budget that is not a number, or a silly one, falls back to the default. */
function normalizeContextChars(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < MIN_CONTEXT_CHARS) {
    return fallback
  }
  return Math.min(value, MAX_CONTEXT_CHARS)
}
