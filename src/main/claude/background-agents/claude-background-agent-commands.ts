import { runProcess } from '@orca/process-host'
import type { ProcessResult } from '@orca/process-host/process-spec'
import {
  CLAUDE_BACKGROUND_AGENT_ID_PATTERN,
  type ClaudeBackgroundAgentCommandResult
} from '../../../shared/claude-background-agents'
import { resolveCommandOnLocalPath } from '../../ipc/command-path/command-path-resolver'
import { hostShellEnvironment } from '../../runtime/agent-session/environment/structured-agent-shell-environment'
import { CLAUDE_BACKGROUND_AGENTS_TIMEOUT_MS } from './claude-background-agent-list'

/** Dispatching waits for the agent to come up, which takes longer than a listing does. */
export const CLAUDE_BACKGROUND_AGENT_DISPATCH_TIMEOUT_MS = 30_000

export type ClaudeBackgroundAgentCommandDependencies = {
  /** Injected so the tests exercise the parsing without a Claude Code install. */
  runCommand?: typeof runProcess
  resolveCommand?: typeof resolveCommandOnLocalPath
  resolveEnvironment?: () => Promise<NodeJS.ProcessEnv>
}

/** The CLI prints the new agent's id after `backgrounded`; what counts as an id is the shared rule. */
const DISPATCHED_AGENT_LINE_PATTERN = /^backgrounded\s*·\s*(\S+)/m

type ClaudeCommandRun = { ok: true; result: ProcessResult } | { ok: false; message: string }

/**
 * Start a background agent and report the id the CLI gave it.
 *
 * `claude --bg` takes no `--cwd`, so the agent's directory is the one the command runs in.
 */
export async function dispatchClaudeBackgroundAgent(
  args: {
    prompt: string
    cwd?: string | null
    model?: string | null
    permissionMode?: string | null
  },
  dependencies: ClaudeBackgroundAgentCommandDependencies = {}
): Promise<ClaudeBackgroundAgentCommandResult> {
  const run = await runClaudeCommand(
    [
      '--bg',
      ...(args.model ? ['--model', args.model] : []),
      ...(args.permissionMode ? ['--permission-mode', args.permissionMode] : []),
      args.prompt
    ],
    { timeoutMs: CLAUDE_BACKGROUND_AGENT_DISPATCH_TIMEOUT_MS, cwd: args.cwd },
    dependencies
  )
  if (!run.ok) {
    return run
  }
  const id = readDispatchedAgentId(run.result.stdout)
  if (!id) {
    return { ok: false, message: failureMessage(run.result) }
  }
  return { ok: true, id }
}

/** Stop a background agent; its conversation is kept, so the panel can open it again. */
export async function stopClaudeBackgroundAgent(
  args: { id: string },
  dependencies: ClaudeBackgroundAgentCommandDependencies = {}
): Promise<ClaudeBackgroundAgentCommandResult> {
  return runAgentIdCommand('stop', args.id, dependencies)
}

/** Delete a background agent and its worktree; there is no undo for this. */
export async function removeClaudeBackgroundAgent(
  args: { id: string },
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
    { timeoutMs: CLAUDE_BACKGROUND_AGENTS_TIMEOUT_MS },
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
      timeoutMs: options.timeoutMs
    })
    if (result.code !== 0 || result.timedOut) {
      return { ok: false, message: failureMessage(result) }
    }
    return { ok: true, result }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/** The id the CLI printed for the agent it started; without it there is no agent to name. */
function readDispatchedAgentId(stdout: string): string | null {
  const candidate = DISPATCHED_AGENT_LINE_PATTERN.exec(stdout)?.[1]
  return candidate && CLAUDE_BACKGROUND_AGENT_ID_PATTERN.test(candidate) ? candidate : null
}

/** What the CLI said about its refusal; an empty stderr means it said nothing at all. */
function failureMessage(result: ProcessResult): string {
  return result.stderr.trim() || 'the CLI did not report why'
}
