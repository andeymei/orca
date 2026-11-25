import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import { useAiInstructionComments } from '../../diff-comments/use-diff-comment-owner'
import { isAiInstructionCompletedByStatus } from './ai-instruction-status'

/**
 * Watches the agent status feed and stamps the instructions whose agent finished. It covers the
 * whole active workspace, so an instruction of a file that is not open completes too.
 */
export function useAiInstructionCompletion(): void {
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const markAiInstructionsCompleted = useAppStore((s) => s.markAiInstructionsCompleted)
  const { owner, comments } = useAiInstructionComments(activeWorktreeId, 'selection')
  // The projection, not the status map: this hook watches the panes that carry an instruction, and
  // a fleet-wide map re-renders every reader on every status update anywhere in the fleet.
  const projection = useAppStore((s) => s.agentStatusByPaneKey.projection)
  const subscribeToStatusChanges = useCallback(
    (listener: () => void) => projection.subscribeChanges(listener),
    [projection]
  )
  const readStatusRevision = useCallback(() => projection.changeCursor(), [projection])
  const statusRevision = useSyncExternalStore(
    subscribeToStatusChanges,
    readStatusRevision,
    readStatusRevision
  )
  // A failed write rolls the store back, which re-fires this effect with the same ids; only a real
  // status change may release them.
  const blockedIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    blockedIdsRef.current.clear()
  }, [statusRevision])

  useEffect(() => {
    if (!owner || !comments) {
      return
    }
    // The live map, read at the moment of the scan: the projection says which panes changed, the
    // map says what they say now.
    const statuses = useAppStore.getState().agentStatusByPaneKey
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
        status: statuses.get(record.dispatchedPaneKey)
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
  }, [statusRevision, comments, markAiInstructionsCompleted, owner])
}
