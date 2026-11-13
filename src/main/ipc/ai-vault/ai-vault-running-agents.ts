import type { ClaudeBackgroundAgent } from '../../../shared/claude-background-agents'
import { LOCAL_EXECUTION_HOST_ID, parseExecutionHostId } from '../../../shared/execution-host'

/** Where the agents of a host come from. */
export type RunningAgentSource = {
  /** This machine's own Claude Code agents. */
  listLocalAgents: () => Promise<ClaudeBackgroundAgent[]>
  /** The agents a paired runtime host runs; null when that host cannot report them. */
  listRuntimeAgents: (environmentId: string) => Promise<ClaudeBackgroundAgent[] | null>
}

/**
 * The agents running on the host that owns the conversation.
 *
 * This machine's listing cannot speak for a conversation that runs on another host, so that
 * host is asked. A host that is not a paired runtime environment runs no conversations Orca
 * can open, so it has nothing to report; a host that could not report says so with null, and
 * the caller asks that host itself.
 */
export async function listRunningAgentsForHost(
  executionHostId: string | undefined,
  source: RunningAgentSource
): Promise<ClaudeBackgroundAgent[] | null> {
  const hostId = executionHostId?.trim()
  if (!hostId || hostId === LOCAL_EXECUTION_HOST_ID) {
    return source.listLocalAgents()
  }
  const parsed = parseExecutionHostId(hostId)
  if (parsed?.kind !== 'runtime') {
    return []
  }
  return source.listRuntimeAgents(parsed.environmentId)
}
