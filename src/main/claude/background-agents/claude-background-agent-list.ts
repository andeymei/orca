import { runProcess } from '@orca/process-host'
import {
  CLAUDE_BACKGROUND_AGENTS_MAX_OUTPUT_BYTES,
  readClaudeBackgroundAgentsListing,
  type ClaudeBackgroundAgent
} from '../../../shared/claude-background-agents'
import { resolveCommandOnLocalPath } from '../../ipc/command-path/command-path-resolver'
import { hostShellEnvironment } from '../../runtime/agent-session/environment/structured-agent-shell-environment'

export const CLAUDE_BACKGROUND_AGENTS_ARGS: readonly string[] = ['agents', '--json']

/** The listing is a local daemon query; a wedged CLI must not hold the picker open. */
export const CLAUDE_BACKGROUND_AGENTS_TIMEOUT_MS = 5_000

/** The CLI's stderr can be a quarter of a megabyte; the panel only needs the reason. */
const MAX_FAILURE_MESSAGE_LENGTH = 500

export type ClaudeBackgroundAgentDependencies = {
  /** Injected so tests exercise the parsing without a Claude Code install. */
  runCommand?: typeof runProcess
  resolveCommand?: typeof resolveCommandOnLocalPath
  resolveEnvironment?: () => Promise<NodeJS.ProcessEnv>
}

/** What this machine's Claude Code CLI can tell about its agents. */
type ClaudeBackgroundAgentListing =
  | { status: 'ready'; agents: ClaudeBackgroundAgent[] }
  | { status: 'unsupported' }
  | { status: 'error'; message: string }

/**
 * The Claude Code agents running on this machine.
 *
 * A conversation that is already running must be opened, not copied: resuming it makes the CLI
 * fork the conversation into a second session, which shows up as a duplicate agent.
 */
export async function listClaudeBackgroundAgents(
  dependencies: ClaudeBackgroundAgentDependencies = {}
): Promise<ClaudeBackgroundAgent[]> {
  const listing = await readLocalClaudeBackgroundAgentListing(dependencies)
  return listing.status === 'ready' ? listing.agents : []
}

/**
 * The same agents, or null when this machine has no Claude Code CLI to ask.
 *
 * A CLI that is installed but cannot answer throws: the panel keeps the list it already had
 * instead of showing an empty one.
 */
export async function listClaudeBackgroundAgentsOrNull(
  dependencies: ClaudeBackgroundAgentDependencies = {}
): Promise<ClaudeBackgroundAgent[] | null> {
  const listing = await readLocalClaudeBackgroundAgentListing(dependencies)
  if (listing.status === 'unsupported') {
    return null
  }
  if (listing.status === 'error') {
    throw new Error(listing.message)
  }
  return listing.agents
}

async function readLocalClaudeBackgroundAgentListing(
  dependencies: ClaudeBackgroundAgentDependencies
): Promise<ClaudeBackgroundAgentListing> {
  const env = await (dependencies.resolveEnvironment ?? hostShellEnvironment)()
  const program = await (dependencies.resolveCommand ?? resolveCommandOnLocalPath)('claude', {
    platform: process.platform,
    env
  })
  if (!program) {
    return { status: 'unsupported' }
  }
  const result = await (dependencies.runCommand ?? runProcess)({
    program,
    args: CLAUDE_BACKGROUND_AGENTS_ARGS,
    env,
    timeoutMs: CLAUDE_BACKGROUND_AGENTS_TIMEOUT_MS,
    maxOutputBytes: CLAUDE_BACKGROUND_AGENTS_MAX_OUTPUT_BYTES
  })
  if (result.timedOut) {
    return { status: 'error', message: 'the Claude Code CLI timed out' }
  }
  if (result.code !== 0) {
    return { status: 'error', message: readFailureMessage(result.stderr) }
  }
  // Why: a CLI that answered with something else did not report "no agents", it reported nothing
  // anybody can read, and the panel must not show that as an empty list.
  const listing = readClaudeBackgroundAgentsListing(result.stdout)
  if (!listing.ok) {
    return { status: 'error', message: listing.message }
  }
  return { status: 'ready', agents: listing.agents }
}

/** What the CLI said about its refusal, trimmed to what a panel can show. */
function readFailureMessage(stderr: string): string {
  const trimmed = stderr.trim()
  if (!trimmed) {
    return 'the Claude Code CLI failed'
  }
  return trimmed.length > MAX_FAILURE_MESSAGE_LENGTH
    ? `${trimmed.slice(0, MAX_FAILURE_MESSAGE_LENGTH)}…`
    : trimmed
}
