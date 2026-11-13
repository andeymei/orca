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
  if (!Array.isArray(parsed)) {
    return []
  }
  const agents: ClaudeBackgroundAgent[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') {
      continue
    }
    const record = entry as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id : ''
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : ''
    if (!id || !sessionId) {
      continue
    }
    agents.push({
      id,
      sessionId,
      name: typeof record.name === 'string' ? record.name : '',
      cwd: typeof record.cwd === 'string' ? record.cwd : ''
    })
  }
  return agents
}
