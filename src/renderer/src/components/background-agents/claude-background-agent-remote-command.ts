import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { toRuntimeWorktreeSelector } from '@/runtime/rpc/targets/runtime-worktree-selector'
import { translate } from '@/i18n/i18n'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import {
  commandSeparator,
  quoteStartupArg,
  resolveStartupShell,
  type AgentStartupShell
} from '../../../../shared/agent-launch/startup/tui-agent-startup-shell'
import { quotePowerShellNativeArgument } from '../../../../shared/powershell-native-argument'
import {
  CLAUDE_BACKGROUND_AGENT_CANCELLED_MESSAGE,
  type ClaudeBackgroundAgentCommandResult
} from '../../../../shared/claude-background-agents'
import { stripAnsiEscapeSequences } from '../../../../shared/ansi-escape-sequences'
import type { RuntimeTerminalCreate } from '../../../../shared/runtime-terminal-create-contract'
import type { RuntimeTerminalRead } from '../../../../shared/runtime-terminal-contracts'
import { delayUnlessAborted } from '../../../../shared/abort-aware-delay'

/** How long the host's CLI may take before the panel stops waiting for its answer. */
const REMOTE_CLAUDE_COMMAND_TIMEOUT_MS = 30_000

/** How often the host's terminal is read again while the command runs. */
const REMOTE_CLAUDE_COMMAND_POLL_MS = 400

/** The lines read from the host's terminal in one poll; the answer is at its end. */
const REMOTE_CLAUDE_COMMAND_TAIL_LIMIT = 120

/** The marker the command prints with its exit code once it is done. */
const REMOTE_CLAUDE_COMMAND_RESULT_PREFIX = 'ORCA_CLAUDE_RESULT_'

/** The marker line, with the exit code the command ended with. */
const REMOTE_CLAUDE_COMMAND_RESULT_PATTERN = /^ORCA_CLAUDE_RESULT_(\d+)$/

/**
 * The id the CLI printed, read from a terminal stream.
 *
 * A terminal redraws the line the CLI prints, so the id may sit behind a spinner or a prompt
 * instead of at the start of a line; the id's own shape is what tells it apart.
 */
const REMOTE_CLAUDE_DISPATCHED_ID_PATTERN = /backgrounded[^\w]{0,8}([0-9a-f]{8})/

/** The shell a Windows host runs the command in; the panel pins it so the quoting is certain. */
const WINDOWS_COMMAND_SHELL = 'powershell.exe'

/** What a command on a paired host said. */
export type RemoteClaudeCommandOutcome =
  | { ok: true; exitCode: number; tail: string[] }
  | { ok: false; message: string }

/**
 * One argument of a command on a paired host.
 *
 * A word the shell passes through unchanged needs no quotes, and cmd reads a quoted one as a name
 * with quotes in it. The prompt reaches the CLI as a native argument, and Windows PowerShell 5.1
 * drops embedded quotes when it builds one, so that shell gets the native form.
 */
function quoteRemoteArg(value: string, shell: AgentStartupShell): string {
  if (/^[A-Za-z0-9_.-]+$/.test(value)) {
    return value
  }
  return shell === 'powershell'
    ? quotePowerShellNativeArgument(value)
    : quoteStartupArg(value, shell)
}

/**
 * The command that reports how the command before it ended.
 *
 * Each shell reports its last command's status differently, and cmd expands `%ERRORLEVEL%` before
 * the command runs, so cmd asks with `if errorlevel` instead.
 */
function buildResultCommand(shell: AgentStartupShell): string {
  if (shell === 'cmd') {
    return `if errorlevel 1 (echo ${REMOTE_CLAUDE_COMMAND_RESULT_PREFIX}1) else (echo ${REMOTE_CLAUDE_COMMAND_RESULT_PREFIX}0)`
  }
  if (shell === 'powershell') {
    return `echo ${REMOTE_CLAUDE_COMMAND_RESULT_PREFIX}$LASTEXITCODE`
  }
  return `echo ${REMOTE_CLAUDE_COMMAND_RESULT_PREFIX}$?`
}

/** The command a paired host runs, with the line that reports how it ended. */
export function buildRemoteClaudeCommand(
  shell: AgentStartupShell,
  cliArgs: readonly string[]
): string {
  const command = ['claude', ...cliArgs.map((arg) => quoteRemoteArg(arg, shell))].join(' ')
  // Why the call operator: PowerShell runs a quoted program name as a string, not as a program.
  const invocation = shell === 'powershell' ? `& ${command}` : command
  return `${invocation}${commandSeparator(shell)}${buildResultCommand(shell)}`
}

/** The exit code the command printed, or null while it is still running. */
function readExitCode(tail: readonly string[]): number | null {
  for (let index = tail.length - 1; index >= 0; index -= 1) {
    const match = REMOTE_CLAUDE_COMMAND_RESULT_PATTERN.exec(tail[index].trim())
    if (match) {
      return Number(match[1])
    }
  }
  return null
}

/**
 * What the host said before the command ended.
 *
 * The lines after the marker are the shell's own prompt, so only what came between the command's
 * echo and the marker is the command's answer.
 */
function readCommandAnswer(tail: readonly string[]): string {
  const markerIndex = tail.findIndex((line) =>
    REMOTE_CLAUDE_COMMAND_RESULT_PATTERN.test(line.trim())
  )
  const said = (markerIndex === -1 ? tail : tail.slice(0, markerIndex))
    .map((line) => line.trim())
    .filter((line) => line !== '')
  // The shell echoes the command it was given; that echo is not the command's answer.
  const answered = /^&?\s*claude\b/.test(said[0] ?? '') ? said.slice(1) : said
  return answered.slice(-3).join(' ')
}

/** The terminal a paired host runs the command in; it is closed as soon as the command is done. */
async function createRemoteCommandTerminal(args: {
  environmentId: string
  platform: NodeJS.Platform
  command: string
  cwd: string | null
}): Promise<string> {
  const created = await callRuntimeRpc<{ terminal: RuntimeTerminalCreate }>(
    { kind: 'environment', environmentId: args.environmentId },
    'terminal.create',
    {
      // Why the floating scope: a terminal made for a workspace joins that workspace's tab
      // inventory, and this app mirrors a paired host's inventory into its own tab bar.
      worktree: toRuntimeWorktreeSelector(FLOATING_TERMINAL_WORKTREE_ID),
      command: args.command,
      ...(args.cwd ? { cwd: args.cwd } : {}),
      // Why the pinned shell: the panel quotes the prompt for one dialect, so the host has to run
      // that shell. A host that predates the override runs its own default, which is the same one.
      ...(args.platform === 'win32' ? { shell: WINDOWS_COMMAND_SHELL } : {}),
      startupCommandDelivery: 'fast',
      // Why: the command's output is read here, not shown; the host's window must not take focus.
      presentation: 'background'
    },
    { timeoutMs: 15_000 }
  )
  const handle = created.terminal?.handle
  if (typeof handle !== 'string' || handle === '') {
    throw new Error('the paired host did not return a terminal handle')
  }
  return handle
}

/** Closes the host's terminal; the command it ran is gone with it. */
async function closeRemoteCommandTerminal(args: {
  environmentId: string
  handle: string
}): Promise<void> {
  await callRuntimeRpc(
    { kind: 'environment', environmentId: args.environmentId },
    'terminal.close',
    { terminal: args.handle },
    { timeoutMs: 15_000 }
  )
}

/** Reads the host's terminal until the command reports how it ended. */
async function readRemoteCommandOutcome(args: {
  environmentId: string
  handle: string
  signal?: AbortSignal
}): Promise<RemoteClaudeCommandOutcome> {
  const deadline = Date.now() + REMOTE_CLAUDE_COMMAND_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (args.signal?.aborted) {
      return { ok: false, message: CLAUDE_BACKGROUND_AGENT_CANCELLED_MESSAGE }
    }
    let read: { terminal: RuntimeTerminalRead }
    try {
      read = await callRuntimeRpc<{ terminal: RuntimeTerminalRead }>(
        { kind: 'environment', environmentId: args.environmentId },
        'terminal.read',
        { terminal: args.handle, limit: REMOTE_CLAUDE_COMMAND_TAIL_LIMIT },
        { timeoutMs: 15_000, ...(args.signal ? { signal: args.signal } : {}) }
      )
    } catch (error) {
      // Why: an aborted read is the panel's own cancel, not a host that could not answer.
      if (args.signal?.aborted) {
        return { ok: false, message: CLAUDE_BACKGROUND_AGENT_CANCELLED_MESSAGE }
      }
      throw error
    }
    const tail = read.terminal?.tail ?? []
    const exitCode = readExitCode(tail)
    if (exitCode !== null) {
      return { ok: true, exitCode, tail }
    }
    await delayUnlessAborted(
      REMOTE_CLAUDE_COMMAND_POLL_MS,
      args.signal ?? new AbortController().signal
    )
  }
  return {
    ok: false,
    message: translate(
      'auto.components.backgroundAgents.remoteHostTimeout',
      'the host did not answer in time'
    )
  }
}

/**
 * Runs one Claude Code command on a paired host and reads what it printed.
 *
 * The host serves no method that runs a command, so the command runs in a terminal on that host —
 * the same way the agent's own terminal is previewed there. The terminal is closed as soon as the
 * command is done, so the host keeps nothing of it.
 */
export async function runRemoteClaudeCommand(args: {
  environmentId: string
  platform: NodeJS.Platform
  /** The Claude Code arguments, without the program itself. */
  cliArgs: readonly string[]
  cwd?: string | null
  signal?: AbortSignal
}): Promise<RemoteClaudeCommandOutcome> {
  const shell = resolveStartupShell(args.platform)
  const handle = await createRemoteCommandTerminal({
    environmentId: args.environmentId,
    platform: args.platform,
    command: buildRemoteClaudeCommand(shell, args.cliArgs),
    cwd: args.cwd ?? null
  })
  try {
    return await readRemoteCommandOutcome({
      environmentId: args.environmentId,
      handle,
      ...(args.signal ? { signal: args.signal } : {})
    })
  } finally {
    // Why: the command's terminal is the panel's own scratch space, not the user's.
    await closeRemoteCommandTerminal({ environmentId: args.environmentId, handle }).catch(() => {})
  }
}

/** Starts a background agent on a paired host and reports the id its CLI gave it. */
export async function dispatchRemoteClaudeBackgroundAgent(args: {
  environmentId: string
  platform: NodeJS.Platform
  cwd: string | null
  prompt: string
  signal?: AbortSignal
}): Promise<ClaudeBackgroundAgentCommandResult> {
  const run = await runRemoteClaudeCommand({
    environmentId: args.environmentId,
    platform: args.platform,
    cliArgs: ['--bg', '--', args.prompt],
    cwd: args.cwd,
    ...(args.signal ? { signal: args.signal } : {})
  })
  if (!run.ok) {
    return run
  }
  const id = REMOTE_CLAUDE_DISPATCHED_ID_PATTERN.exec(
    stripAnsiEscapeSequences(run.tail.join('\n'))
  )?.[1]
  if (id) {
    return { ok: true, id }
  }
  return {
    ok: false,
    message:
      readCommandAnswer(run.tail) ||
      translate(
        'auto.components.backgroundAgents.remoteHostNoAgentId',
        'the host did not report an agent id'
      )
  }
}

/** Stops or deletes an agent on a paired host. */
export async function runRemoteClaudeAgentCommand(args: {
  environmentId: string
  platform: NodeJS.Platform
  verb: 'stop' | 'rm'
  agentId: string
}): Promise<ClaudeBackgroundAgentCommandResult> {
  const run = await runRemoteClaudeCommand({
    environmentId: args.environmentId,
    platform: args.platform,
    cliArgs: [args.verb, args.agentId]
  })
  if (!run.ok) {
    return run
  }
  if (run.exitCode !== 0) {
    return {
      ok: false,
      message:
        readCommandAnswer(run.tail) ||
        translate(
          'auto.components.backgroundAgents.remoteHostRefused',
          'the host refused the command'
        )
    }
  }
  return { ok: true, id: args.agentId }
}
