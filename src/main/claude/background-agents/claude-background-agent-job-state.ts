import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CLAUDE_BACKGROUND_AGENT_ID_PATTERN,
  isRecord,
  type ClaudeBackgroundAgentDetail
} from '../../../shared/claude-background-agents'
import { defaultClaudeConfigDir } from '../claude-config-dir-pin'

/** Only an ISO timestamp is a timestamp; `Date.parse` would read '5' as a year. */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

export type ClaudeBackgroundAgentJobStateOptions = {
  /** Injected so a test reads a fixture instead of the real ~/.claude. */
  readFile?: (path: string) => Promise<string | null>
  /** Injected so a test does not read the real home directory. */
  configDir?: string
}

/**
 * The agent's own state file; the CLI's listing does not carry it.
 *
 * A missing or unparsable file is normal — the panel then shows the row without its
 * activity line rather than losing the row.
 */
export async function readClaudeBackgroundAgentJobState(
  agentId: string,
  options: ClaudeBackgroundAgentJobStateOptions = {}
): Promise<ClaudeBackgroundAgentDetail | null> {
  // The id becomes a path segment, so only the CLI's own short id may reach the disk.
  if (!CLAUDE_BACKGROUND_AGENT_ID_PATTERN.test(agentId)) {
    return null
  }
  const configDir = options.configDir ?? defaultClaudeConfigDir()
  const read = options.readFile ?? readTextFile
  const raw = await read(join(configDir, 'jobs', agentId, 'state.json'))
  if (raw === null) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) {
    return null
  }
  return {
    detail: typeof parsed.detail === 'string' ? parsed.detail : null,
    needs: typeof parsed.needs === 'string' ? parsed.needs : null,
    updatedAt: readUpdatedAt(parsed.updatedAt)
  }
}

/** The CLI writes an ISO timestamp; an older job carries epoch ms. Both become epoch ms. */
function readUpdatedAt(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string' && ISO_TIMESTAMP.test(value)) {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

/**
 * A file that is gone, or that the CLI is writing right now, is not an error.
 *
 * A permission error is treated the same way on purpose: the row's contract is "no activity line",
 * and a misconfigured `CLAUDE_CONFIG_DIR` is not something the row can act on.
 */
async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}
