import { useAppStore } from '@/store/index'
import { findKnownWorktreeById } from '@/store/slices/worktrees/listing/detected-worktree-meta'
import {
  parseExecutionHostId,
  toRuntimeExecutionHostId,
  type ExecutionHostId
} from '../../../../../shared/execution-host/execution-host'
import { resolveExactWorktreeRoute } from './worktree-owner-route'

/**
 * The workspace's directory on the host that owns it.
 *
 * A runtime's physical local host is a different catalog namespace from the client's local
 * host, so the row is looked up in the owner's own catalog and a route that does not match
 * exactly is refused rather than answered with this machine's path.
 */
export function resolveWorktreePathOnOwnerHost(
  worktreeId: string,
  fallbackCwd: string | undefined,
  executionHostId: ExecutionHostId | null | undefined,
  runtimeEnvironmentId?: string | null
): string | null {
  const host = parseExecutionHostId(executionHostId)
  if (!host) {
    return null
  }
  const environmentId =
    runtimeEnvironmentId ?? (host.kind === 'runtime' ? host.environmentId : null)
  const catalogHostId = environmentId ? toRuntimeExecutionHostId(environmentId) : host.id
  const state = useAppStore.getState()
  const worktree = findKnownWorktreeById(state, worktreeId, catalogHostId)
  if (host.kind === 'ssh' && environmentId) {
    const resolution = worktree && resolveExactWorktreeRoute(state, worktree)
    if (
      resolution?.kind !== 'resolved' ||
      resolution.route.runtimeEnvironmentId !== environmentId ||
      resolution.route.executionHostId !== host.id
    ) {
      return null
    }
  } else if (environmentId && parseExecutionHostId(worktree?.hostId)?.kind === 'ssh') {
    return null
  }
  return worktree?.path ?? (catalogHostId === 'local' ? fallbackCwd : null) ?? null
}
