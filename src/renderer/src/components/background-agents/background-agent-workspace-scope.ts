import { createAiVaultScopeCwdMatcher } from '../../../../shared/ai-vault/scanning/ai-vault-scope-cwd-match'
import { deriveAiVaultWorkspaceScopePaths } from '../../../../shared/ai-vault/scanning/ai-vault-scope-paths'
import type { Worktree } from '../../../../shared/worktree/types'

/**
 * The directories an agent may have run in for it to be one of this workspace's agents.
 *
 * An agent is recorded by the directory it ran in, so the workspace's own path — and the paths it
 * had before a rename — are what decide whether an agent belongs to it. This is the **workspace**
 * rule, the same one the AI Vault panel scopes its list with: the sibling worktrees of the same
 * repository are *not* part of it. (The project rule, which does include them, is
 * `deriveAiVaultScopeSessionPaths`.)
 */
export function deriveBackgroundAgentScopePaths(
  activeWorktree: Pick<Worktree, 'id' | 'path' | 'priorWorktreeIds' | 'repoId'> | null,
  liveWorktrees: readonly Pick<Worktree, 'id' | 'path' | 'repoId'>[] = []
): readonly string[] {
  return deriveAiVaultWorkspaceScopePaths(activeWorktree, liveWorktrees)
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
