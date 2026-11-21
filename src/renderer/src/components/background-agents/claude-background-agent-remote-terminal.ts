import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { toRuntimeWorktreeSelector } from '@/runtime/rpc/targets/runtime-worktree-selector'
import { translate } from '@/i18n/i18n'
import { toRemoteRuntimePtyId } from '../../../../shared/remote-runtime/remote-runtime-pty-id'
import { buildClaudeAttachStartup } from '../../../../shared/ai-vault/resume/ai-vault-attach-startup'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import type { RuntimeTerminalCreate } from '../../../../shared/runtime-terminal-create-contract'
import { readHostPlatform, WINDOWS_COMMAND_SHELL } from './background-agent-host-platform'

/** A terminal on a paired host, as the panel previews it. */
export type RemoteBackgroundAgentTerminal = {
  /** The id the preview API addresses the host's terminal by. */
  ptyId: string
  /** The host's own handle, for closing that terminal again. */
  handle: string
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
  agentId: string
  cwd: string | null
}): Promise<RemoteBackgroundAgentTerminal> {
  // Why the host's own platform: the attach command is quoted for one shell, and the host is the
  // only one that knows which shell it runs.
  const platform = await readHostPlatform(args.environmentId)
  if (!platform) {
    // Why the refusal: a host that reports no platform gets no command — one quoted for the wrong
    // shell is not a command.
    throw new Error(
      translate(
        'auto.components.backgroundAgents.remoteHostUnknownPlatform',
        'the host does not report its platform'
      )
    )
  }
  const startup = buildClaudeAttachStartup({
    platform,
    agentId: args.agentId,
    cwd: args.cwd
  })
  const created = await callRuntimeRpc<{ terminal: RuntimeTerminalCreate }>(
    { kind: 'environment', environmentId: args.environmentId },
    'terminal.create',
    {
      // Why the floating scope: a terminal made for a workspace joins that workspace's tab
      // inventory, and this app mirrors a paired host's inventory into its own tab bar — the
      // agent would show up there a second time. The floating scope is the one the mirror drops,
      // and it is what this machine's own agent terminal uses.
      worktree: toRuntimeWorktreeSelector(FLOATING_TERMINAL_WORKTREE_ID),
      command: startup.command,
      ...(startup.cwd ? { cwd: startup.cwd } : {}),
      // Why the pinned shell: the attach command is quoted for one shell, and the host is the
      // only one that knows which shell it runs.
      ...(platform === 'win32' ? { shell: WINDOWS_COMMAND_SHELL } : {}),
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
