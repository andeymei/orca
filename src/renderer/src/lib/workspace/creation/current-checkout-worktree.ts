import type { Worktree } from '../../../../../shared/worktree/types'
import type { TaskCheckoutTarget } from '../../../../../shared/new-workspace/task-checkout-target'

/** The repo's own checkout; Orca lists it as the main worktree, and its branch is the one the user develops on. */
export function findCurrentCheckoutWorktree(
  worktrees: readonly Worktree[],
  repoId: string | null | undefined
): Worktree | undefined {
  if (!repoId) {
    return undefined
  }
  return worktrees.find((worktree) => worktree.repoId === repoId && worktree.isMainWorktree)
}

/** A detached HEAD has no branch to develop on, so it cannot host a task. */
export function getCurrentCheckoutBranch(worktree: Worktree | undefined): string | null {
  const branch = worktree?.branch.replace(/^refs\/heads\//, '').trim() ?? ''
  return branch && branch !== 'HEAD' ? branch : null
}

export function getCurrentCheckoutBranchForRepo(
  worktrees: readonly Worktree[],
  repoId: string | null | undefined
): string | null {
  return getCurrentCheckoutBranch(findCurrentCheckoutWorktree(worktrees, repoId))
}

/** A repo without a checkout to develop on cannot host the task, so it falls back to a new worktree. */
export function resolveEffectiveCheckoutTarget(args: {
  checkoutTarget: TaskCheckoutTarget
  worktrees: readonly Worktree[]
  repoId: string | null | undefined
}): TaskCheckoutTarget {
  if (args.checkoutTarget !== 'current-checkout') {
    return args.checkoutTarget
  }
  return getCurrentCheckoutBranchForRepo(args.worktrees, args.repoId)
    ? 'current-checkout'
    : 'new-workspace'
}
