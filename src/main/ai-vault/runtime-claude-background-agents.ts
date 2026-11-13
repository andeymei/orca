// The Claude Code agents running on a paired runtime host.
//
// A conversation that runs on another host is opened there, not resumed: the CLI copies a
// resumed conversation that already runs, and that copy is the second, same-named session the
// user finds afterwards. This host's own listing cannot answer for that conversation, so the
// host that owns it is asked.

import {
  parseClaudeBackgroundAgentsValue,
  type ClaudeBackgroundAgent
} from '../../shared/claude-background-agents'
import { callRuntimeEnvironment } from '../ipc/runtime-environments/runtime-environment-transport-routing'

/** A wedged host must not hold the picker open. */
export const RUNTIME_CLAUDE_BACKGROUND_AGENTS_TIMEOUT_MS = 10_000

export async function listRuntimeClaudeBackgroundAgents(
  userDataPath: string,
  environmentId: string,
  timeoutMs = RUNTIME_CLAUDE_BACKGROUND_AGENTS_TIMEOUT_MS
): Promise<ClaudeBackgroundAgent[] | null> {
  const response = await callRuntimeEnvironment(
    userDataPath,
    environmentId,
    'aiVault.listRunningAgents',
    {},
    timeoutMs
  )
  if (response.ok !== true) {
    // The host could not answer — an Orca older than the method. The caller then asks the host
    // itself, rather than mistaking the silence for a host that runs nothing.
    return null
  }
  return parseClaudeBackgroundAgentsValue(response.result)
}
