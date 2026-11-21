import { translate } from '@/i18n/i18n'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import type { ClaudeBackgroundAgentCommandResult } from '../../../../shared/claude-background-agents'
import { readHostPlatform } from './background-agent-host-platform'
import {
  dispatchRemoteClaudeBackgroundAgent,
  runRemoteClaudeAgentCommand
} from './claude-background-agent-remote-command'

/**
 * The commands the panel sends to the host that owns the workspace.
 *
 * This machine runs the CLI itself; a paired host runs it there, in a terminal on that host.
 */

/** Starts a background agent on the host that owns the workspace. */
export async function dispatchBackgroundAgentOnHost(args: {
  executionHostId: string | null
  prompt: string
  /** The workspace's directory, in the host's own path style. */
  cwd: string | null
  signal?: AbortSignal
}): Promise<ClaudeBackgroundAgentCommandResult> {
  const host = parseExecutionHostId(args.executionHostId)
  if (host?.kind === 'runtime') {
    const platform = await readHostPlatform(host.environmentId)
    if (!platform) {
      return {
        ok: false,
        message: translate(
          'auto.components.backgroundAgents.remoteHostUnknownPlatform',
          'the host does not report its platform'
        )
      }
    }
    return dispatchRemoteClaudeBackgroundAgent({
      environmentId: host.environmentId,
      platform,
      cwd: args.cwd,
      prompt: args.prompt,
      ...(args.signal ? { signal: args.signal } : {})
    })
  }
  return window.api.claudeAgents.dispatch(
    args.cwd ? { prompt: args.prompt, cwd: args.cwd } : { prompt: args.prompt }
  )
}

/** Stops an agent on the host that owns it; its conversation is kept. */
export async function stopBackgroundAgentOnHost(args: {
  executionHostId: string | null
  id: string
  /** The agent's own directory, in the host's own path style. */
  cwd: string | null
}): Promise<ClaudeBackgroundAgentCommandResult> {
  const host = parseExecutionHostId(args.executionHostId)
  if (host?.kind === 'runtime') {
    const platform = await readHostPlatform(host.environmentId)
    if (!platform) {
      return {
        ok: false,
        message: translate(
          'auto.components.backgroundAgents.remoteHostUnknownPlatform',
          'the host does not report its platform'
        )
      }
    }
    return runRemoteClaudeAgentCommand({
      environmentId: host.environmentId,
      platform,
      verb: 'stop',
      agentId: args.id
    })
  }
  return window.api.claudeAgents.stop({ id: args.id })
}

/** Deletes an agent and its worktree on the host that owns it. */
export async function removeBackgroundAgentOnHost(args: {
  executionHostId: string | null
  id: string
  /** The agent's own directory, in the host's own path style. */
  cwd: string | null
}): Promise<ClaudeBackgroundAgentCommandResult> {
  const host = parseExecutionHostId(args.executionHostId)
  if (host?.kind === 'runtime') {
    const platform = await readHostPlatform(host.environmentId)
    if (!platform) {
      return {
        ok: false,
        message: translate(
          'auto.components.backgroundAgents.remoteHostUnknownPlatform',
          'the host does not report its platform'
        )
      }
    }
    return runRemoteClaudeAgentCommand({
      environmentId: host.environmentId,
      platform,
      verb: 'rm',
      agentId: args.id
    })
  }
  return window.api.claudeAgents.remove({ id: args.id })
}
