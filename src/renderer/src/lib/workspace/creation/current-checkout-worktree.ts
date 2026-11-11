import type { Worktree } from '../../../../../shared/worktree/types'

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
