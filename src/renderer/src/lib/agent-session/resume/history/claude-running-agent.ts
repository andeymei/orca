import type { AiVaultSession } from '../../../../../../shared/ai-vault/contracts/ai-vault-types'
import type { ClaudeBackgroundAgent } from '../../../../../../shared/claude-background-agents'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../../../shared/execution-host'

/**
 * The agent already running this conversation, when this machine runs it.
 *
 * A conversation that has a live writer must be opened, not resumed: the CLI copies a resumed
 * conversation that already runs, and that copy is the second, same-named agent the user finds
 * afterwards.
 */
export function runningAgentForSession(
  agents: readonly ClaudeBackgroundAgent[],
  session: AiVaultSession
): ClaudeBackgroundAgent | null {
  if (session.agent !== 'claude') {
    return null
  }
  // A conversation on another host runs there; this machine's agents cannot speak for it.
  if (session.executionHostId && session.executionHostId !== LOCAL_EXECUTION_HOST_ID) {
    return null
  }
  return agents.find((agent) => agent.sessionId === session.sessionId) ?? null
}

/**
 * The agent that runs this conversation, if the CLI reports one.
 *
 * An unreadable listing means "nothing runs": the conversation is then resumed, which is what
 * happened before this check existed.
 */
export async function findRunningAgentForSession(
  session: AiVaultSession
): Promise<ClaudeBackgroundAgent | null> {
  // Only Claude Code lists background agents; the matcher owns the rule, this skips the call.
  if (session.agent !== 'claude') {
    return null
  }
  try {
    const agents = await window.api.aiVault.listRunningAgents()
    return runningAgentForSession(agents, session)
  } catch {
    return null
  }
}
