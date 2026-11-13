// Open a saved conversation on the host that owns it, whether or not it already runs.
//
// The host decides: `claude agents --json` lists the conversations that run on that machine, and
// a running conversation is opened with `claude attach` instead of being resumed. The CLI copies
// a resumed conversation that already runs, and that copy is the second, same-named session the
// user finds afterwards.
//
// This is the fallback for a host that cannot be asked directly — an Orca older than the runtime
// method that answers the listing. The command runs on the host, so the answer comes from the
// host's own CLI.

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
 * The listing runs on the host: a conversation that the host reports as running is attached to,
 * and one it does not report is resumed as before.
 */
export function buildClaudeAttachOrResumeStartup(args: {
  platform: NodeJS.Platform
  shell?: AgentStartupShell
  /** The short id `claude attach` takes: the conversation id's first segment. */
  agentId: string
  /** The conversation id, as `claude agents --json` reports it. */
  sessionId: string
  /** The command that resumes the conversation when the host does not report it running. */
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
  const sessionId = quoteStartupArg(args.sessionId, shell)
  const attach = `${executable} attach ${agentId}`
  const listing = `${executable} agents --json`
  const command =
    shell === 'powershell'
      ? `if ((${listing} | Out-String) -match ${sessionId}) { ${attach} } else { ${args.resumeCommand} }`
      : shell === 'cmd'
        ? `${listing} 2>nul | findstr /c:${sessionId} >nul && (${attach}) || (${args.resumeCommand})`
        : `if ${listing} 2>/dev/null | grep -q ${sessionId}; then ${attach}; else ${args.resumeCommand}; fi`
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
