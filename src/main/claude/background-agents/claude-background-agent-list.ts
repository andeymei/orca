import { runProcess } from '@orca/process-host'
import {
  CLAUDE_BACKGROUND_AGENTS_MAX_OUTPUT_BYTES,
  parseClaudeBackgroundAgents,
  type ClaudeBackgroundAgent
} from '../../../shared/claude-background-agents'
import { resolveCommandOnLocalPath } from '../../ipc/command-path/command-path-resolver'
import { hostShellEnvironment } from '../../runtime/agent-session/environment/structured-agent-shell-environment'

export const CLAUDE_BACKGROUND_AGENTS_ARGS: readonly string[] = ['agents', '--json']

/** The listing is a local daemon query; a wedged CLI must not hold the picker open. */
export const CLAUDE_BACKGROUND_AGENTS_TIMEOUT_MS = 5_000

export type ClaudeBackgroundAgentDependencies = {
  /** Injected so tests exercise the parsing without a Claude Code install. */
  runCommand?: typeof runProcess
  resolveCommand?: typeof resolveCommandOnLocalPath
  resolveEnvironment?: () => Promise<NodeJS.ProcessEnv>
}

/**
 * The Claude Code agents running on this machine.
 *
 * A conversation that is already running must be opened, not copied: resuming it makes the CLI
 * fork the conversation into a second session, which shows up as a duplicate agent.
 */
export async function listClaudeBackgroundAgents(
  dependencies: ClaudeBackgroundAgentDependencies = {}
): Promise<ClaudeBackgroundAgent[]> {
  const env = await (dependencies.resolveEnvironment ?? hostShellEnvironment)()
  const program = await (dependencies.resolveCommand ?? resolveCommandOnLocalPath)('claude', {
    platform: process.platform,
    env
  })
  if (!program) {
    return []
  }
  const result = await (dependencies.runCommand ?? runProcess)({
    program,
    args: CLAUDE_BACKGROUND_AGENTS_ARGS,
    env,
    timeoutMs: CLAUDE_BACKGROUND_AGENTS_TIMEOUT_MS,
    maxOutputBytes: CLAUDE_BACKGROUND_AGENTS_MAX_OUTPUT_BYTES
  })
  if (result.code !== 0 || result.timedOut) {
    return []
  }
  return parseClaudeBackgroundAgents(result.stdout)
}
