// Claude Code's superseded transcripts.
//
// When the CLI supersedes a conversation — it forks a live one, or continues a compacted one —
// it renames the original transcript to `<uuid>.orphaned-<timestamp>-<hash>.jsonl` and writes
// the conversation on under a new name. The renamed file is the same conversation, not a second
// one: listing it is what makes the same session appear twice, under the same title.

/** True for a transcript the CLI renamed when it superseded that conversation. */
export function isSupersededClaudeTranscript(filePath: string): boolean {
  return /\.orphaned-/i.test(filePath)
}

/**
 * The sessions that are not a superseded transcript.
 *
 * A host that still lists the renamed file answers with the same conversation twice; the
 * desktop drops the renamed one, so the list holds the conversation once.
 */
export function withoutSupersededClaudeTranscripts<TSession extends { filePath: string }>(
  sessions: readonly TSession[]
): TSession[] {
  return sessions.filter((session) => !isSupersededClaudeTranscript(session.filePath))
}
