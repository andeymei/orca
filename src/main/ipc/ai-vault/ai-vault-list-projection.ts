// The desktop's projection of a host's session listing.

import {
  OPENS_EVERY_STRUCTURED_CHAT,
  projectStructuredAiVaultSessions
} from '../../ai-vault/structured-session-ownership'
import { withoutSupersededClaudeTranscripts } from '../../../shared/ai-vault/scanning/claude-superseded-transcript'
import type { AiVaultListResult } from '../../../shared/ai-vault/contracts/ai-vault-types'

/**
 * The sessions the desktop shows for one host's answer.
 *
 * A host that still lists the transcript the CLI renamed when it superseded that conversation
 * answers with the same conversation twice, so the renamed one is dropped here.
 */
export function projectAiVaultListResult(result: AiVaultListResult): AiVaultListResult {
  return projectStructuredAiVaultSessions(
    { ...result, sessions: withoutSupersededClaudeTranscripts(result.sessions) },
    OPENS_EVERY_STRUCTURED_CHAT
  )
}
