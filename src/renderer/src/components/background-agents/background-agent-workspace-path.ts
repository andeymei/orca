import type { AppState } from '@/store/types'
import { selectWorktreesByRepo } from '@/store/workspaces/catalog/workspace-record-fields'
import { findFirstIndexedWorktree } from '@/lib/workspace/ownership/worktree-runtime-owner-index'

/**
 * The workspace's directory, on the host that owns it.
 *
 * A paired host's worktree does not exist on this machine, so its record carries the path that
 * host uses. The dispatch runs there and the attachments land there, so both ask this.
 */
export function backgroundAgentWorkspacePath(
  state: Pick<AppState, 'worktreesByRepo'>,
  worktreeId: string | null
): string | null {
  if (!worktreeId) {
    return null
  }
  return findFirstIndexedWorktree(selectWorktreesByRepo(state), worktreeId)?.path ?? null
}
