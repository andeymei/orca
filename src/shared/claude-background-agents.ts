/** A Claude Code background agent, as `claude agents --json` reports it. */
export type ClaudeBackgroundAgent = {
  /** The short id `claude attach` takes. */
  id: string
  /** The conversation id; the same value the AI Vault records for that conversation. */
  sessionId: string
  name: string
  cwd: string
}

/** How many bytes of `claude agents --json` output are read; the envelope is a small array. */
export const CLAUDE_BACKGROUND_AGENTS_MAX_OUTPUT_BYTES = 256 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * The agents from `claude agents --json`.
 *
 * The CLI prints an array, but a broken or older build prints something else; an unreadable
 * listing must not take the picker down with it.
 */
export function parseClaudeBackgroundAgents(stdout: string): ClaudeBackgroundAgent[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return []
  }
  return parseClaudeBackgroundAgentsValue(parsed)
}

/** The same listing, already parsed: a host answers with the value instead of the printed text. */
export function parseClaudeBackgroundAgentsValue(parsed: unknown): ClaudeBackgroundAgent[] {
  if (!Array.isArray(parsed)) {
    return []
  }
  const agents: ClaudeBackgroundAgent[] = []
  for (const entry of parsed) {
    if (!isRecord(entry)) {
      continue
    }
    const id = typeof entry.id === 'string' ? entry.id : ''
    const sessionId = typeof entry.sessionId === 'string' ? entry.sessionId : ''
    if (!id || !sessionId) {
      continue
    }
    agents.push({
      id,
      sessionId,
      name: typeof entry.name === 'string' ? entry.name : '',
      cwd: typeof entry.cwd === 'string' ? entry.cwd : ''
    })
  }
  return agents
}

/** Which host the listing is wanted from; a conversation runs on the host that recorded it. */
export type ClaudeBackgroundAgentRequest = {
  executionHostId?: string
}

/**
 * What the host that owns a conversation says about it.
 *
 * `unknown` is the host's own answer: it could not report its conversations — an Orca older
 * than the method that answers the listing. The host then decides for itself.
 */
export type ClaudeRunningAgentLookup =
  | { status: 'running'; agent: ClaudeBackgroundAgent }
  | { status: 'idle' }
  | { status: 'unknown' }
