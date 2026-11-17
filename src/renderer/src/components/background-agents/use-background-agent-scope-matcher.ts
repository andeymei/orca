import { useMemo } from 'react'
import { useAllWorktrees } from '@/store/slices/worktrees/listing/use-worktree-catalog'
import { useActiveWorktree } from '@/store/workspaces/selection/use-selected-worktree'
import {
  createBackgroundAgentScopeMatcher,
  deriveBackgroundAgentScopePaths
} from './background-agent-workspace-scope'

/**
 * The matcher for the workspace the user is in, recomputed when the workspace changes.
 *
 * The panel subscribes to the workspace instead of reading the store while it renders, so
 * switching projects swaps the roster instead of leaving it on the machine's agents.
 */
export function useBackgroundAgentScopeMatcher(): (cwd: string | null | undefined) => boolean {
  const activeWorktree = useActiveWorktree()
  const allWorktrees = useAllWorktrees()
  const scopePaths = useMemo(
    () => deriveBackgroundAgentScopePaths(activeWorktree ?? null, allWorktrees),
    [activeWorktree, allWorktrees]
  )
  return useMemo(() => createBackgroundAgentScopeMatcher(scopePaths), [scopePaths])
}
