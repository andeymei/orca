import { useMemo } from 'react'
import { createAiVaultScopeCwdMatcher } from '../../../../shared/ai-vault/scanning/ai-vault-scope-cwd-match'
import { deriveAiVaultWorkspaceScopePaths } from '../../../../shared/ai-vault/scanning/ai-vault-scope-paths'
import type { AppState } from '@/store/types'
import { getIndexedAllWorktrees } from '@/store/slices/worktrees/listing/worktree-catalog-index'
import { useAllWorktrees } from '@/store/slices/worktrees/listing/use-worktree-catalog'
import { selectWorktreesByRepo } from '@/store/workspaces/catalog/workspace-record-fields'
import { selectKnownWorktreeById } from '@/store/workspaces/selection/known-worktree-selection'
import { useActiveWorktree } from '@/store/workspaces/selection/use-selected-worktree'

/** The workspace the panel answers for, and the directories its agents live in. */
export type BackgroundAgentWorkspaceScope = {
  workspaceId: string | null
  scopePaths: readonly string[]
}

/**
 * The workspace the user is in, with the directories that belong to it.
 *
 * An agent is recorded by the directory it ran in, so the workspace's own path — and the paths it
 * had before a rename — are what decide whether an agent is one of this workspace's agents. The
 * same paths the AI Vault panel scopes its list with: the workspace's own directory, not the whole
 * project.
 */
export function resolveBackgroundAgentWorkspaceScope(
  state: AppState
): BackgroundAgentWorkspaceScope {
  const workspaceId = state.activeWorktreeId
  if (!workspaceId) {
    return { workspaceId: null, scopePaths: [] }
  }
  const worktree = selectKnownWorktreeById(state, workspaceId)
  if (!worktree) {
    return { workspaceId, scopePaths: [] }
  }
  return {
    workspaceId,
    scopePaths: deriveAiVaultWorkspaceScopePaths(
      worktree,
      getIndexedAllWorktrees(selectWorktreesByRepo(state))
    )
  }
}

/**
 * An agent ran in this workspace when the directory it recorded is inside the workspace.
 *
 * The CLI lists every agent on the machine, so the panel has to ask which of them belong to the
 * open workspace. A workspace without a directory claims nothing, and the matcher that decides it
 * is the one the AI Vault panel uses — it knows about case folding and the WSL path aliases.
 */
export function createBackgroundAgentScopeMatcher(
  scopePaths: readonly string[]
): (cwd: string | null | undefined) => boolean {
  if (scopePaths.length === 0) {
    return () => false
  }
  const inScope = createAiVaultScopeCwdMatcher(scopePaths)
  return (cwd) => inScope(cwd)
}

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
    () => deriveAiVaultWorkspaceScopePaths(activeWorktree ?? null, allWorktrees),
    [activeWorktree, allWorktrees]
  )
  return useMemo(() => createBackgroundAgentScopeMatcher(scopePaths), [scopePaths])
}
