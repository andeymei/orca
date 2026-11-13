import {
  getTuiAgentLaunchCommand,
  TUI_AGENT_CONFIG
} from '../../agent-launch/catalog/tui-agent-config'
import {
  quoteStartupArg,
  resolveStartupShell,
  tokenizeStartupCommand,
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
  /** A configured command may point at another binary; its flags do not apply to attach. */
  commandOverride?: string | null
}): AiVaultResumeStartup {
  const shell = resolveStartupShell(args.platform, args.shell)
  const command = resolveAttachExecutable({
    commandOverride: args.commandOverride,
    platform: args.platform,
    shell
  })
  const agentId = quoteStartupArg(args.agentId, shell)
  return {
    command: `${command} attach ${agentId}`,
    ...(args.cwd ? { cwd: args.cwd } : {})
  }
}

/** The binary to attach with: a configured command's own program, else the catalog's. */
function resolveAttachExecutable(args: {
  commandOverride?: string | null
  platform: NodeJS.Platform
  shell: AgentStartupShell
}): string {
  const override = args.commandOverride?.trim()
  if (override) {
    const parsed = tokenizeStartupCommand(override, args.shell)
    // Why: the override's flags configure a run, and attach is not that run.
    if (parsed.ok && parsed.tokens.length > 0) {
      return parsed.tokens[0]
    }
  }
  return getTuiAgentLaunchCommand(TUI_AGENT_CONFIG.claude, args.platform)
}
