import { runProcess } from '@orca/process-host'
import type { ProcessResult } from '@orca/process-host/process-spec'
import {
  CLAUDE_BACKGROUND_AGENT_CANCELLED_MESSAGE,
  CLAUDE_BACKGROUND_AGENT_ID_PATTERN,
  CLAUDE_BACKGROUND_AGENTS_MAX_OUTPUT_BYTES,
  readClaudeBackgroundAgentFailureMessage,
  type ClaudeBackgroundAgentCommandResult,
  type ClaudeBackgroundAgentDispatchArgs,
  type ClaudeBackgroundAgentIdArgs
} from '../../../shared/claude-background-agents'
import { resolveCommandOnLocalPath } from '../../ipc/command-path/command-path-resolver'
import { hostShellEnvironment } from '../../runtime/agent-session/environment/structured-agent-shell-environment'
import { stripAnsiEscapeSequences } from '../../../shared/ansi-escape-sequences'
import { CLAUDE_BACKGROUND_AGENTS_TIMEOUT_MS } from './claude-background-agent-list'

/** Dispatching waits for the agent to come up, which takes longer than a listing does. */
export const CLAUDE_BACKGROUND_AGENT_DISPATCH_TIMEOUT_MS = 30_000

/** Deleting an agent also deletes its worktree; a kill mid-delete leaves half a worktree behind. */
export const CLAUDE_BACKGROUND_AGENT_REMOVE_TIMEOUT_MS = 30_000

export type ClaudeBackgroundAgentCommandDependencies = {
  /** Injected so the tests exercise the parsing without a Claude Code install. */
  runCommand?: typeof runProcess
  resolveCommand?: typeof resolveCommandOnLocalPath
  resolveEnvironment?: () => Promise<NodeJS.ProcessEnv>
  /** Aborts the command while it runs; the panel cancels a dispatch that is still opening. */
  signal?: AbortSignal
}

/** The CLI prints the new agent's id after `backgrounded`; what counts as an id is the shared rule. */
const DISPATCHED_AGENT_LINE_PATTERN = /^backgrounded\s*·\s*(\S+)/m

/**
 * The permission modes the CLI itself accepts.
 *
 * `bypassPermissions` is in the set on purpose: it is a first-class mode in Claude Code and this
 * machine's `claude agents` already defaults to it, so dropping it would make the panel's agents
 * behave unlike the ones the user runs in a terminal — the opposite of what the panel is for. It
 * crosses no permission boundary either: the caller is Orca's own renderer, which can already run
 * any command as the user through `window.api.pty.spawn({command})`. The set exists so that what
 * reaches the CLI is always a mode the CLI knows, never a flag smuggled in as one.
 */
const CLAUDE_PERMISSION_MODES: readonly string[] = [
  'acceptEdits',
  'auto',
  'bypassPermissions',
  'manual',
  'dontAsk',
  'plan'
]

/** Stopping is quick; removing is not, because it takes the worktree with it. */
const AGENT_COMMAND_TIMEOUTS = {
  stop: CLAUDE_BACKGROUND_AGENTS_TIMEOUT_MS,
  rm: CLAUDE_BACKGROUND_AGENT_REMOVE_TIMEOUT_MS
} as const

type ClaudeCommandRun = { ok: true; result: ProcessResult } | { ok: false; message: string }

/**
 * Start a background agent and report the id the CLI gave it.
 *
 * `claude --bg` takes no `--cwd`, so the agent's directory is the one the command runs in.
 */
export async function dispatchClaudeBackgroundAgent(
  args: ClaudeBackgroundAgentDispatchArgs,
  dependencies: ClaudeBackgroundAgentCommandDependencies = {}
): Promise<ClaudeBackgroundAgentCommandResult> {
  const refusal = refuseDispatchArguments(args)
  if (refusal) {
    return { ok: false, message: refusal }
  }
  const run = await runClaudeCommand(
    [
      '--bg',
      ...(args.model ? ['--model', args.model] : []),
      ...(args.permissionMode ? ['--permission-mode', args.permissionMode] : []),
      // Everything after `--` is text, so a prompt that starts with a dash is not read as an option.
      '--',
      args.prompt
    ],
    {
      timeoutMs: CLAUDE_BACKGROUND_AGENT_DISPATCH_TIMEOUT_MS,
      cwd: args.cwd
    },
    dependencies
  )
  if (!run.ok) {
    return run
  }
  const id = readDispatchedAgentId(run.result.stdout)
  if (!id) {
    return {
      ok: false,
      message: readClaudeBackgroundAgentFailureMessage(
        run.result.stderr,
        'the CLI did not print an agent id'
      )
    }
  }
  return { ok: true, id }
}

/** A model or a permission mode the CLI would read as an option is neither of them. */
function refuseDispatchArguments(args: {
  model?: string | null
  permissionMode?: string | null
}): string | null {
  if (args.permissionMode && !CLAUDE_PERMISSION_MODES.includes(args.permissionMode)) {
    return 'not a permission mode'
  }
  if (args.model && args.model.startsWith('-')) {
    return 'not a model name'
  }
  return null
}

/** Stop a background agent; its conversation is kept, so the panel can open it again. */
export async function stopClaudeBackgroundAgent(
  args: ClaudeBackgroundAgentIdArgs,
  dependencies: ClaudeBackgroundAgentCommandDependencies = {}
): Promise<ClaudeBackgroundAgentCommandResult> {
  return runAgentIdCommand('stop', args.id, dependencies)
}

/** Delete a background agent and its worktree; there is no undo for this. */
export async function removeClaudeBackgroundAgent(
  args: ClaudeBackgroundAgentIdArgs,
  dependencies: ClaudeBackgroundAgentCommandDependencies = {}
): Promise<ClaudeBackgroundAgentCommandResult> {
  return runAgentIdCommand('rm', args.id, dependencies)
}

/**
 * Run one `claude` command for one agent.
 *
 * The CLI takes a name where an id belongs, and two agents can share a name — so the panel only
 * ever passes the short id the CLI printed.
 */
async function runAgentIdCommand(
  verb: 'stop' | 'rm',
  id: string,
  dependencies: ClaudeBackgroundAgentCommandDependencies
): Promise<ClaudeBackgroundAgentCommandResult> {
  if (!CLAUDE_BACKGROUND_AGENT_ID_PATTERN.test(id)) {
    return { ok: false, message: 'not a background agent id' }
  }
  const run = await runClaudeCommand(
    [verb, id],
    { timeoutMs: AGENT_COMMAND_TIMEOUTS[verb] },
    dependencies
  )
  return run.ok ? { ok: true, id } : run
}

/** Run one `claude` command and report what it said. */
async function runClaudeCommand(
  args: readonly string[],
  options: { timeoutMs: number; cwd?: string | null },
  dependencies: ClaudeBackgroundAgentCommandDependencies
): Promise<ClaudeCommandRun> {
  try {
    const env = await (dependencies.resolveEnvironment ?? hostShellEnvironment)()
    const program = await (dependencies.resolveCommand ?? resolveCommandOnLocalPath)('claude', {
      platform: process.platform,
      env
    })
    if (!program) {
      return { ok: false, message: 'Claude Code CLI not found' }
    }
    const result = await (dependencies.runCommand ?? runProcess)({
      program,
      args,
      cwd: options.cwd ?? undefined,
      env,
      timeoutMs: options.timeoutMs,
      maxOutputBytes: CLAUDE_BACKGROUND_AGENTS_MAX_OUTPUT_BYTES,
      signal: dependencies.signal
    })
    if (result.code !== 0 || result.timedOut) {
      return { ok: false, message: failureMessage(result, dependencies.signal) }
    }
    return { ok: true, result }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/** The id the CLI printed for the agent it started; without it there is no agent to name. */
function readDispatchedAgentId(stdout: string): string | null {
  // Why: the CLI colors its answer when the environment asks for color, so the id — and the words
  // around it — arrive wrapped in escape sequences. The id reader is what has to understand that
  // answer, so the answer is cleaned here rather than on every command's stdout.
  const candidate = DISPATCHED_AGENT_LINE_PATTERN.exec(stripAnsiEscapeSequences(stdout))?.[1]
  return candidate && CLAUDE_BACKGROUND_AGENT_ID_PATTERN.test(candidate) ? candidate : null
}

/**
 * Why the command failed.
 *
 * The abort comes first: the panel asked for it, and it is the only reason the caller knows of.
 * A timeout kills the child too, so it has to be read before the signal that the kill left behind.
 */
function failureMessage(result: ProcessResult, signal?: AbortSignal): string {
  if (signal?.aborted) {
    return CLAUDE_BACKGROUND_AGENT_CANCELLED_MESSAGE
  }
  if (result.timedOut) {
    return 'the CLI timed out'
  }
  if (result.signal !== null) {
    return 'the CLI was stopped before it finished'
  }
  return readClaudeBackgroundAgentFailureMessage(result.stderr, 'the CLI did not report why')
}
