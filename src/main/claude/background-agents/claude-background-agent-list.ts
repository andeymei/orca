import { runProcess } from '@orca/process-host'
import {
  CLAUDE_BACKGROUND_AGENTS_MAX_OUTPUT_BYTES,
  readClaudeBackgroundAgentFailureMessage,
  readClaudeBackgroundAgentsListing,
  type ClaudeBackgroundAgent
} from '../../../shared/claude-background-agents'
import { resolveCommandOnLocalPath } from '../../ipc/command-path/command-path-resolver'
import { hostShellEnvironment } from '../../runtime/agent-session/environment/structured-agent-shell-environment'
import { UNKNOWN_OPTION_DIAGNOSTIC } from '../claude-cli-flag-support'
import { backgroundAgentCommandEnvironment } from './claude-background-agent-environment'

/**
 * The listing the panel asks the CLI for.
 *
 * `--json` alone prints the **active** sessions only, so the Completed section would always be
 * empty and `claude rm` would be unreachable. `--all` adds the completed background sessions,
 * which is what the Completed section and the delete path need.
 */
export const CLAUDE_BACKGROUND_AGENTS_ARGS: readonly string[] = ['agents', '--json', '--all']

/** The listing a CLI that does not know `--all` can still answer. */
const CLAUDE_BACKGROUND_AGENTS_ARGS_WITHOUT_ALL: readonly string[] = ['agents', '--json']

/** The option that asks the CLI for the completed sessions too. */
const ALL_OPTION = '--all'

/** The listing is a local daemon query; a wedged CLI must not hold the picker open. */
export const CLAUDE_BACKGROUND_AGENTS_TIMEOUT_MS = 5_000

/**
 * Remembers that a CLI refused `--all`.
 *
 * The listing is polled every 15 seconds, so asking a CLI that does not know the option again
 * would buy a failed spawn every time. The memory is per binary: a CLI installed elsewhere is a
 * different CLI, and one replaced in place is asked again after Orca restarts.
 */
export type ClaudeBackgroundAgentAllFlagMemory = {
  /** Whether this CLI already refused the option. */
  refused: (program: string) => boolean
  /** Remember that this CLI refused the option. */
  remember: (program: string) => void
}

const programsThatRefusedAll = new Set<string>()

const defaultAllFlagMemory: ClaudeBackgroundAgentAllFlagMemory = {
  refused: (program) => programsThatRefusedAll.has(program),
  remember: (program) => {
    programsThatRefusedAll.add(program)
  }
}

export type ClaudeBackgroundAgentDependencies = {
  /** Injected so tests exercise the parsing without a Claude Code install. */
  runCommand?: typeof runProcess
  resolveCommand?: typeof resolveCommandOnLocalPath
  resolveEnvironment?: () => Promise<NodeJS.ProcessEnv>
  /** Injected so a test can drive the downgrade without a real CLI. */
  allFlagMemory?: ClaudeBackgroundAgentAllFlagMemory
}

/** What this machine's Claude Code CLI can tell about its agents. */
type LocalClaudeBackgroundAgentListing =
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
): Promise<LocalClaudeBackgroundAgentListing> {
  const env = backgroundAgentCommandEnvironment(
    await (dependencies.resolveEnvironment ?? hostShellEnvironment)()
  )
  const program = await (dependencies.resolveCommand ?? resolveCommandOnLocalPath)('claude', {
    platform: process.platform,
    env
  })
  if (!program) {
    return { status: 'unsupported' }
  }
  const run = dependencies.runCommand ?? runProcess
  const memory = dependencies.allFlagMemory ?? defaultAllFlagMemory
  const spec = {
    program,
    env,
    timeoutMs: CLAUDE_BACKGROUND_AGENTS_TIMEOUT_MS,
    maxOutputBytes: CLAUDE_BACKGROUND_AGENTS_MAX_OUTPUT_BYTES
  }
  // Why: a CLI that already refused the option is not asked for it again.
  const args = memory.refused(program)
    ? CLAUDE_BACKGROUND_AGENTS_ARGS_WITHOUT_ALL
    : CLAUDE_BACKGROUND_AGENTS_ARGS
  let result = await run({ ...spec, args })
  if (
    !result.timedOut &&
    result.code !== 0 &&
    !memory.refused(program) &&
    refusedAllOption(result.stderr)
  ) {
    // Why: a CLI that does not know `--all` still knows `--json`, so the panel keeps working with
    // an empty Completed section instead of no roster at all. The downgrade is remembered, so the
    // next poll does not pay the failed spawn again.
    memory.remember(program)
    result = await run({ ...spec, args: CLAUDE_BACKGROUND_AGENTS_ARGS_WITHOUT_ALL })
  }
  if (result.timedOut) {
    return { status: 'error', message: 'the Claude Code CLI timed out' }
  }
  if (result.code !== 0) {
    return {
      status: 'error',
      message: readClaudeBackgroundAgentFailureMessage(result.stderr, 'the Claude Code CLI failed')
    }
  }
  // Why: a CLI that answered with something else did not report "no agents", it reported nothing
  // anybody can read, and the panel must not show that as an empty list.
  const listing = readClaudeBackgroundAgentsListing(result.stdout)
  if (!listing.ok) {
    return { status: 'error', message: listing.message }
  }
  return { status: 'ready', agents: listing.agents }
}

/**
 * Whether the CLI said it does not know the option.
 *
 * Only the CLI's own unknown-option diagnostic proves a refusal: a timeout, a crash or any other
 * failure is a real failure, and falling back on it would hide a broken CLI behind a list that
 * looks fine.
 */
function refusedAllOption(stderr: string): boolean {
  return UNKNOWN_OPTION_DIAGNOSTIC.exec(stderr)?.[1] === ALL_OPTION
}
