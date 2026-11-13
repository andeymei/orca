// The session id Claude Code accepts when a resume pins it.
//
// The CLI rejects a pinned id that is not a UUID, so only a real one may be pinned.

const CLAUDE_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The id to pin the resume to, or null when the CLI would not accept it. */
export function pinnableClaudeSessionId(sessionId: string | null | undefined): string | null {
  const trimmed = sessionId?.trim()
  if (!trimmed || !CLAUDE_SESSION_ID.test(trimmed)) {
    return null
  }
  return trimmed
}
