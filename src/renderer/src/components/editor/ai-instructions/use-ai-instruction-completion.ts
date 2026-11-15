import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import { useAiInstructionComments } from '../../diff-comments/use-diff-comment-owner'
import { isAiInstructionCompletedByStatus } from './ai-instruction-status'

/**
 * Watches the agent status feed and stamps the instructions whose agent finished. It covers the
 * whole active workspace, so an instruction of a file that is not open completes too.
 */
export function useAiInstructionCompletion(): void {
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const agentStatusByPaneKey = useAppStore((s) => s.agentStatusByPaneKey)
  const markAiInstructionsCompleted = useAppStore((s) => s.markAiInstructionsCompleted)
  const { owner, comments } = useAiInstructionComments(activeWorktreeId, 'selection')
  // A failed write rolls the store back, which re-fires this effect with the same ids; only a real
  // status change may release them.
  const blockedIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    blockedIdsRef.current.clear()
  }, [agentStatusByPaneKey])

  useEffect(() => {
    if (!owner || !comments) {
      return
    }
    const ids: string[] = []
    for (const record of comments) {
      if (record.sentAt === undefined || record.completedAt !== undefined) {
        continue
      }
      if (record.dispatchedPaneKey === undefined) {
        continue
      }
      if (blockedIdsRef.current.has(record.id)) {
        continue
      }
      const completed = isAiInstructionCompletedByStatus({
        sentAt: record.sentAt,
        completedAt: record.completedAt,
        status: agentStatusByPaneKey[record.dispatchedPaneKey]
      })
      if (completed) {
        ids.push(record.id)
      }
    }
    if (ids.length === 0) {
      return
    }
    for (const id of ids) {
      blockedIdsRef.current.add(id)
    }
    void markAiInstructionsCompleted(owner, ids)
      .then((completed) => {
        if (!completed) {
          return
        }
        for (const id of ids) {
          blockedIdsRef.current.delete(id)
        }
      })
      .catch((err) => {
        console.error('Failed to complete AI instruction records:', err)
      })
  }, [agentStatusByPaneKey, comments, markAiInstructionsCompleted, owner])
}
