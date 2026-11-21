import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { toRuntimeWorktreeSelector } from '@/runtime/rpc/targets/runtime-worktree-selector'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import type { RuntimeTerminalCreate } from '../../../../shared/runtime-terminal-create-contract'

/**
 * The platform a paired host runs its terminals in.
 *
 * The host answers with its own platform when it creates a terminal, so the panel asks the host
 * and keeps the answer. A path says nothing about the machine that owns it: a command quoted for
 * one shell is not a command under another, and a Windows host whose shell is cmd.exe reads
 * `'single quotes'` as ordinary text.
 */
const hostPlatforms = new Map<string, NodeJS.Platform>()

/**
 * The shell a Windows host runs a panel command in.
 *
 * The panel pins it, so the command is quoted for exactly the shell that parses it: a Windows
 * host whose own shell is cmd.exe reads a single-quoted word as ordinary text.
 */
export const WINDOWS_COMMAND_SHELL = 'powershell.exe'

/** The platform the host reported earlier, when it has. */
export function cachedHostPlatform(environmentId: string): NodeJS.Platform | null {
  return hostPlatforms.get(environmentId) ?? null
}

/**
 * The host's platform, asked once per environment.
 *
 * The probe is a terminal the host opens for nothing: its answer carries the platform, and it is
 * closed again right away. A host that reports no platform gets no command — a command quoted for
 * the wrong shell is not a command.
 */
export async function readHostPlatform(environmentId: string): Promise<NodeJS.Platform | null> {
  const cached = hostPlatforms.get(environmentId)
  if (cached) {
    return cached
  }
  const created = await callRuntimeRpc<{ terminal: RuntimeTerminalCreate }>(
    { kind: 'environment', environmentId },
    'terminal.create',
    {
      // Why the floating scope: a terminal made for a workspace joins that workspace's tab
      // inventory, and this app mirrors a paired host's inventory into its own tab bar.
      worktree: toRuntimeWorktreeSelector(FLOATING_TERMINAL_WORKTREE_ID),
      startupCommandDelivery: 'fast',
      // Why: the probe is never shown, and the host's window must not take focus for it.
      presentation: 'background'
    },
    { timeoutMs: 15_000 }
  )
  const handle = created.terminal?.handle
  const platform = created.terminal?.hostPlatform
  if (handle) {
    // Why the swallowed failure: the probe has nothing to report to, and a shell that would not
    // close is the host's own business.
    await callRuntimeRpc(
      { kind: 'environment', environmentId },
      'terminal.close',
      { terminal: handle },
      { timeoutMs: 15_000 }
    ).catch(() => {})
  }
  if (!platform) {
    return null
  }
  hostPlatforms.set(environmentId, platform)
  return platform
}

/** Forgets the per-environment answers; a test uses this instead of depending on order. */
export function resetHostPlatformsForTests(): void {
  hostPlatforms.clear()
}
