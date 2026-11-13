import {
  getTuiAgentLaunchCommand,
  TUI_AGENT_CONFIG
} from '../../agent-launch/catalog/tui-agent-config'
import {
  quoteStartupArg,
  resolveStartupShell,
  type AgentStartupShell
} from '../../agent-launch/startup/tui-agent-startup-shell'
import type { AiVaultResumeStartup } from './ai-vault-resume-startup'

/**
 * The command that opens a conversation that is already running.
 *
 * `claude attach` shows the running agent; it keeps the conversation's own id, so the machine ends
 * up with the agent it had. Resuming the same conversation instead makes the CLI copy it into a
 * second session, which is the duplicate a user sees afterwards.
 */
export function buildClaudeAttachStartup(args: {
  platform: NodeJS.Platform
  shell?: AgentStartupShell
  /** The short id `claude agents` lists. */
  agentId: string
  cwd?: string | null
}): AiVaultResumeStartup {
  const command = getTuiAgentLaunchCommand(TUI_AGENT_CONFIG.claude, args.platform)
  const agentId = quoteStartupArg(args.agentId, resolveStartupShell(args.platform, args.shell))
  return {
    command: `${command} attach ${agentId}`,
    ...(args.cwd ? { cwd: args.cwd } : {})
  }
}
