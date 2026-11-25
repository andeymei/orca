import path from 'node:path'
import { readNodeFileWithinLimit } from '../../shared/file-content/node-bounded-file-reader'

/**
 * The env keys that decide where the agent's requests go, with which credential and as which
 * model.
 *
 * Why these and not the whole env block: a settings file's env can hold anything — a CI token, a
 * shell path, a plugin setting — and the refactoring agent runs with the tool gate as its only
 * arbiter, so it gets the provider connection and nothing else.
 */
const PROVIDER_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL'
] as const

/** A settings file is the user's own; it is small, but it is not bounded by anything else. */
const REFACTOR_SETTINGS_MAX_BYTES = 1024 * 1024

/**
 * The provider connection a host's Claude settings carry.
 *
 * Why the settings file: a host whose Claude points at a gateway keeps its base URL and token in
 * the `env` block of `settings.json`, and the refactoring agent runs with the SDK's isolation
 * mode — it loads no settings file — so without this the agent would reach the default endpoint
 * with no credential and answer "Not logged in".
 *
 * Why this does not reopen the gate: the gate never depended on the isolation mode. The
 * PreToolUse hook runs before every tool, whether or not a permission rule approved it first, so
 * a user's allow rule still cannot write outside the scratch tree. What the isolation buys is
 * that the agent sees no project conventions — and the app reads those itself when it wants them.
 */
export async function readRefactorProviderEnv(configDir: string): Promise<Record<string, string>> {
  const settingsPath = path.join(configDir, 'settings.json')
  let text: string
  try {
    const read = await readNodeFileWithinLimit(settingsPath, REFACTOR_SETTINGS_MAX_BYTES)
    text = read.buffer.toString('utf8')
  } catch {
    // A host without a settings file runs Claude on its own credentials; nothing to carry.
    return {}
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {}
  }
  if (!isRecord(parsed)) {
    return {}
  }
  const env = parsed.env
  if (!isRecord(env)) {
    return {}
  }
  const provider: Record<string, string> = {}
  for (const key of PROVIDER_ENV_KEYS) {
    const value = env[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      provider[key] = value
    }
  }
  return provider
}

/** A JSON object; the settings file's own shape is not this code's to know. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
