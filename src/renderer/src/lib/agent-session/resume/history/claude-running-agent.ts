import type { AiVaultSession } from '../../../../../../shared/ai-vault/contracts/ai-vault-types'
import type {
  ClaudeBackgroundAgent,
  ClaudeRunningAgentLookup
} from '../../../../../../shared/claude-background-agents'

/**
 * The agent already running this conversation, as the host that runs it reports it.
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
  return agents.find((agent) => agent.sessionId === session.sessionId) ?? null
}

/**
 * What the host that owns the conversation says about it.
 *
 * The listing comes from the host that owns the conversation: this machine's agents cannot speak
 * for a conversation that runs on another host. A host that cannot report leaves the answer
 * unknown, and the host decides for itself when the conversation is opened.
 */
export async function findRunningAgentForSession(
  session: AiVaultSession
): Promise<ClaudeRunningAgentLookup> {
  // Only Claude Code lists background agents; the matcher owns the rule, this skips the call.
  if (session.agent !== 'claude') {
    return { status: 'idle' }
  }
  try {
    const agents = await window.api.aiVault.listRunningAgents(
      session.executionHostId ? { executionHostId: session.executionHostId } : undefined
    )
    if (!agents) {
      return { status: 'unknown' }
    }
    const agent = runningAgentForSession(agents, session)
    return agent ? { status: 'running', agent } : { status: 'idle' }
  } catch {
    return { status: 'unknown' }
  }
}
