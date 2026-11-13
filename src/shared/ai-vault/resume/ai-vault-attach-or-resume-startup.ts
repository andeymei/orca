// Open a saved conversation on the host that owns it, whether or not it already runs.
//
// The native way to open a conversation that runs is `claude attach <id>`: it shows the running
// agent and keeps the conversation's own id. Resuming it instead makes the CLI copy the
// conversation into a second, same-named session — the "<title> (2)" the user finds afterwards.
//
// This is the fallback for a host that cannot be asked directly — an Orca older than the runtime
// method that reports the running conversations. The command runs on the host, so the host's own
// CLI decides: `claude attach` fails with "No job matching" for a conversation nobody runs, and
// the resume runs only then.

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

/**
 * The command that opens a conversation whether or not it is already running.
 *
 * The attach comes first because it is the native open: a conversation that runs is shown where it
 * runs, and a conversation nobody runs makes the attach fail, which is what lets the resume follow.
 */
export function buildClaudeAttachOrResumeStartup(args: {
  platform: NodeJS.Platform
  shell?: AgentStartupShell
  /** The short id `claude attach` takes: the conversation id's first segment. */
  agentId: string
  /** The command that resumes the conversation when the attach finds no running agent. */
  resumeCommand: string
  cwd?: string | null
  /** A configured command may point at another binary; its flags do not apply to attach. */
  commandOverride?: string | null
}): { command: string; cwd?: string } {
  const shell = resolveStartupShell(args.platform, args.shell)
  const executable = resolveClaudeExecutable({
    commandOverride: args.commandOverride,
    platform: args.platform,
    shell
  })
  const agentId = quoteStartupArg(args.agentId, shell)
  const attach = `${executable} attach ${agentId}`
  const command =
    shell === 'powershell'
      ? `${attach}; if ($LASTEXITCODE -ne 0) { ${args.resumeCommand} }`
      : shell === 'cmd'
        ? `${attach} || (${args.resumeCommand})`
        : `if ${attach}; then :; else ${args.resumeCommand}; fi`
  return {
    command,
    ...(args.cwd ? { cwd: args.cwd } : {})
  }
}

/** The binary to ask: a configured command's own program, else the catalog's. */
function resolveClaudeExecutable(args: {
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
