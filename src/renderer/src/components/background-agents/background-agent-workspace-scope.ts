import type { AiVaultSession } from '../../../../shared/ai-vault/contracts/ai-vault-types'
import {
  aiVaultSessionInScope,
  createAiVaultScopeCwdMatcher
} from '../../../../shared/ai-vault/scanning/ai-vault-scope-cwd-match'
import { deriveAiVaultWorkspaceScopePaths } from '../../../../shared/ai-vault/scanning/ai-vault-scope-paths'
import type { AppState } from '@/store/types'
import { getIndexedAllWorktrees } from '@/store/slices/worktrees/listing/worktree-catalog-index'
import { selectWorktreesByRepo } from '@/store/workspaces/catalog/workspace-record-fields'
import { selectKnownWorktreeById } from '@/store/workspaces/selection/known-worktree-selection'

/** The workspace the picker answers for, and the directories its sessions live in. */
export type BackgroundAgentWorkspaceScope = {
  workspaceId: string | null
  scopePaths: readonly string[]
}

/**
 * The workspace the user is in, with the directories that belong to it.
 *
 * An agent session is recorded by the directory it ran in, so the workspace's own path — and the
 * paths it had before a rename — are what decide whether a session is one of this workspace's
 * agents. The same paths the AI Vault panel scopes its list with.
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
 * A session ran in this workspace when the directory it recorded is inside the workspace.
 *
 * A host that does not answer the scoped list still returns everything it knows, so the rows are
 * checked here as well.
 */
export function createBackgroundAgentScopeMatcher(
  scopePaths: readonly string[]
): (session: AiVaultSession) => boolean {
  if (scopePaths.length === 0) {
    return () => true
  }
  const inScope = createAiVaultScopeCwdMatcher(scopePaths)
  return (session) => aiVaultSessionInScope(inScope, session)
}
