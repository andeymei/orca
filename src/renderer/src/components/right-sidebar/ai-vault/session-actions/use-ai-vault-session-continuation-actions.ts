import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { isAiVaultDatabaseAgent } from '../../../../../../shared/ai-vault/contracts/ai-vault-session-handoff'
import type { AiVaultSession } from '../../../../../../shared/ai-vault/contracts/ai-vault-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import type { AgentSessionContinuationRequest } from '@/lib/agent-session/context/agent-session-continuation'
import {
  loadDatabaseAiVaultSessionContinuation,
  prepareAiVaultSessionContinuation
} from './ai-vault-session-continuation'
import {
  notifyAiVaultSessionNoContinuationContext,
  resolveAiVaultSessionLaunchTargetOrNotify
} from './ai-vault-session-launch-feedback'
import { resolveAiVaultTargetWorkspacePath } from './ai-vault-session-launch-target'
import type { AiVaultSessionResumeTargetState } from './ai-vault-session-resume'

/**
 * Hand Off: continue a conversation in a new session on the host that owns it.
 *
 * The dialog is open from the moment the request starts, even before the host answers:
 * an open dialog whose request is null is still saving the conversation on its host.
 */
export function useAiVaultSessionContinuationActions({
  activeWorktree,
  activeWorktreeId,
  targetState
}: {
  activeWorktree: Worktree | null
  activeWorktreeId: string | null
  targetState: AiVaultSessionResumeTargetState
}) {
  // An open dialog whose request is null is still saving the conversation on its host.
  const [continuation, setContinuation] = useState<{
    request: AgentSessionContinuationRequest | null
  } | null>(null)
  // Only the latest Hand Off may fill or close the dialog.
  const continuationAttempt = useRef<object | null>(null)

  const handleContinueInNewSession = useCallback(
    (session: AiVaultSession, targetWorktreeId: string): void => {
      const targetId = resolveAiVaultSessionLaunchTargetOrNotify({
        sessionFilePath: session.filePath,
        sessionExecutionHostId: session.executionHostId,
        activeWorktreeId: activeWorktreeId ?? activeWorktree?.id ?? null,
        targetWorktreeId,
        targetState
      })
      if (!targetId) {
        return
      }

      const targetWorkspacePath = resolveAiVaultTargetWorkspacePath(
        targetState,
        targetId.worktreeId
      )
      if (!targetWorkspacePath) {
        toast.error(
          translate(
            'auto.components.right.sidebar.AiVaultPanel.openWorkspaceBeforeResuming',
            'Open a workspace before resuming a session.'
          )
        )
        return
      }
      const target = { session, targetWorktreeId: targetId.worktreeId, targetWorkspacePath }
      const attempt = {}
      continuationAttempt.current = attempt
      if (!isAiVaultDatabaseAgent(session.agent)) {
        setContinuation({ request: prepareAiVaultSessionContinuation(target) })
        return
      }
      setContinuation({ request: null })
      void loadDatabaseAiVaultSessionContinuation(target).then((request) => {
        if (continuationAttempt.current !== attempt) {
          return
        }
        if (request) {
          setContinuation({ request })
          return
        }
        setContinuation(null)
        notifyAiVaultSessionNoContinuationContext()
      })
    },
    [activeWorktree?.id, activeWorktreeId, targetState]
  )

  const handleContinuationDialogOpenChange = useCallback((open: boolean): void => {
    if (!open) {
      continuationAttempt.current = null
      setContinuation(null)
    }
  }, [])

  return {
    handleContinueInNewSession,
    continuationOpen: continuation !== null,
    continuationRequest: continuation?.request ?? null,
    handleContinuationDialogOpenChange
  }
}
