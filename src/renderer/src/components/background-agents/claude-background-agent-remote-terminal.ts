import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { toRuntimeWorktreeSelector } from '@/runtime/rpc/targets/runtime-worktree-selector'
import { toRemoteRuntimePtyId } from '../../../../shared/remote-runtime/remote-runtime-pty-id'
import { buildClaudeAttachStartup } from '../../../../shared/ai-vault/resume/ai-vault-attach-startup'
import type { RuntimeTerminalCreate } from '../../../../shared/runtime-terminal-create-contract'

/** A terminal on a paired host, as the panel previews it. */
export type RemoteBackgroundAgentTerminal = {
  /** The id the preview API addresses the host's terminal by. */
  ptyId: string
  /** The host's own handle, for closing that terminal again. */
  handle: string
}

/** The host that runs the agent also runs the shell its terminal starts. */
function hostPlatformOf(cwd: string | null): NodeJS.Platform {
  if (!cwd) {
    return 'linux'
  }
  if (/^[A-Za-z]:[\\/]/.test(cwd)) {
    return 'win32'
  }
  return /^\/(Users|Volumes)\//.test(cwd) ? 'darwin' : 'linux'
}

/**
 * The paired host's terminal for one agent.
 *
 * The agent's process lives on that host, so the attach runs there too: `claude attach` on the
 * host shows the agent's own TUI, and the panel previews the host's terminal instead of typing
 * into a terminal on this machine.
 */
export async function createRemoteBackgroundAgentTerminal(args: {
  environmentId: string
  /** The workspace's worktree on the host; the host resolves it by this id. */
  worktreeId: string
  agentId: string
  cwd: string | null
}): Promise<RemoteBackgroundAgentTerminal> {
  const startup = buildClaudeAttachStartup({
    platform: hostPlatformOf(args.cwd),
    agentId: args.agentId,
    cwd: args.cwd
  })
  const created = await callRuntimeRpc<{ terminal: RuntimeTerminalCreate }>(
    { kind: 'environment', environmentId: args.environmentId },
    'terminal.create',
    {
      worktree: toRuntimeWorktreeSelector(args.worktreeId),
      command: startup.command,
      ...(startup.cwd ? { cwd: startup.cwd } : {}),
      startupCommandDelivery: 'fast',
      // Why: the panel's preview is the only surface for this terminal; the host's own window
      // must not take focus for a background agent the user opened from a sidebar.
      presentation: 'background'
    },
    { timeoutMs: 15_000 }
  )
  const handle = created.terminal?.handle
  if (typeof handle !== 'string' || handle === '') {
    throw new Error('the paired host did not return a terminal handle')
  }
  return { ptyId: toRemoteRuntimePtyId(handle, args.environmentId), handle }
}

/**
 * Closes the host's terminal.
 *
 * The agent keeps running: the attach client is what leaves, the way it does on this machine.
 */
export async function closeRemoteBackgroundAgentTerminal(args: {
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
