// Open a saved conversation, given what the host that owns it says about it.

import type { AgentStartupShell } from '../../agent-launch/startup/tui-agent-startup-shell'
import { buildClaudeAttachOrResumeStartup } from './ai-vault-attach-or-resume-startup'
import type { AiVaultResumeStartup } from './ai-vault-resume-startup'

/**
 * The startup that opens a conversation whose running state the host could not report.
 *
 * The command asks the host itself: it lists the conversations that run there and attaches to
 * one that does, so the conversation is never resumed while it runs — resuming it is what makes
 * the CLI copy it into a second, same-named session.
 */
export function buildClaudeSessionStartupForUnknownHost(args: {
  sessionId: string
  platform: NodeJS.Platform
  shell?: AgentStartupShell
  /** The command that resumes the conversation when the host reports it not running. */
  resumeStartup: AiVaultResumeStartup
  commandOverride?: string | null
}): AiVaultResumeStartup {
  const startup = buildClaudeAttachOrResumeStartup({
    platform: args.platform,
    shell: args.shell,
    agentId: claudeAttachAgentId(args.sessionId),
    sessionId: args.sessionId,
    resumeCommand: args.resumeStartup.command,
    cwd: args.resumeStartup.cwd ?? null,
    commandOverride: args.commandOverride
  })
  return {
    ...args.resumeStartup,
    ...startup
  }
}

/**
 * The short id `claude attach` takes: the conversation id's first segment.
 *
 * The CLI derives it from the conversation id, the same way it names the job directory.
 */
export function claudeAttachAgentId(sessionId: string): string {
  const firstSegment = sessionId.split('-')[0]?.trim() ?? ''
  return firstSegment || sessionId.slice(0, 8)
}
