import type { AiVaultSession } from '../../../../shared/ai-vault/contracts/ai-vault-types'
import { isAiVaultSessionResumableContent } from '../../../../shared/ai-vault/contracts/ai-vault-types'
import { resolveAiVaultSessionWorktreeInfo } from '../../../../shared/ai-vault/session-display/ai-vault-session-worktree'
import type { AppState } from '@/store/types'
import { selectFolderWorkspaces } from '@/store/workspaces/catalog/workspace-record-fields'
import { getIndexedAllWorktrees } from '@/store/slices/worktrees/listing/worktree-catalog-index'
import { aiVaultSessionOwnerWorkspaces } from '@/components/right-sidebar/ai-vault/session-list/ai-vault-session-worktree'
import type { BackgroundAgentWorkspace } from './background-agent-session-list'

/** The picker offers the newest sessions; the search box reaches the rest. */
export const BACKGROUND_AGENT_VAULT_LIMIT = 50

/** The workspace a session belongs to, so the picker can group it and name the group. */
export function aiVaultSessionWorkspace(
  state: AppState,
  session: AiVaultSession
): BackgroundAgentWorkspace {
  const worktrees = aiVaultSessionOwnerWorkspaces(
    getIndexedAllWorktrees(state.worktreesByRepo),
    selectFolderWorkspaces(state)
  )
  const info = resolveAiVaultSessionWorktreeInfo({
    session,
    repos: state.repos,
    worktrees,
    activeWorktreeId: state.activeWorktreeId
  })
  return {
    id: info?.worktreeId ?? null,
    label: info?.label ?? session.cwd ?? ''
  }
}

function sessionUpdatedAt(session: AiVaultSession): number {
  const parsed = Date.parse(session.updatedAt ?? '')
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * The agent sessions Orca can bring back, newest first.
 *
 * An agent that runs in a terminal outside Orca still leaves a transcript behind, and the AI
 * Vault indexes it. Those are the agents the picker exists for: the ones Orca cannot see on
 * screen. A session Orca already shows is left out — it is not in the background.
 */
export function backgroundAgentVaultRows(
  sessions: readonly AiVaultSession[],
  canOpen: (session: AiVaultSession) => boolean,
  limit = BACKGROUND_AGENT_VAULT_LIMIT
): AiVaultSession[] {
  return sessions
    .filter(
      (session) =>
        !session.subagent && isAiVaultSessionResumableContent(session) && canOpen(session)
    )
    .sort((left, right) => sessionUpdatedAt(right) - sessionUpdatedAt(left))
    .slice(0, limit)
}
