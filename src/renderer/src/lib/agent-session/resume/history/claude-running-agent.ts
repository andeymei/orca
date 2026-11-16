import type { AiVaultSession } from '../../../../../../shared/ai-vault/contracts/ai-vault-types'
import {
  CLAUDE_BACKGROUND_AGENT_FINISHED_STATES,
  type ClaudeBackgroundAgent,
  type ClaudeRunningAgentLookup
} from '../../../../../../shared/claude-background-agents'

/**
 * The agent already running this conversation, as the host that runs it reports it.
 *
 * A conversation that has a live writer must be opened, not resumed: the CLI copies a resumed
 * conversation that already runs, and that copy is the second, same-named agent the user finds
 * afterwards.
 *
 * The rule that decides "running" lives here, where the question is asked, so that a listing
 * which also carries finished agents cannot answer it wrongly.
 */
export function runningAgentForSession(
  agents: readonly ClaudeBackgroundAgent[],
  session: AiVaultSession
): ClaudeBackgroundAgent | null {
  if (session.agent !== 'claude') {
    return null
  }
  return (
    agents.find((agent) => agent.sessionId === session.sessionId && isRunningAgent(agent)) ?? null
  )
}

/**
 * Whether the agent still writes to its conversation.
 *
 * A finished agent does not, and attaching to one would wake it up again: the conversation would
 * end up with a daemon-backed writer the user never asked for.
 */
function isRunningAgent(agent: ClaudeBackgroundAgent): boolean {
  const state = agent.state
  if (state === undefined) {
    // Why: an unknown state is not a finished state — the agent may still be writing.
    return true
  }
  return !CLAUDE_BACKGROUND_AGENT_FINISHED_STATES.includes(state)
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
