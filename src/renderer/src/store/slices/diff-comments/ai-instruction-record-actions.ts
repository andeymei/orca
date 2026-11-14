import type { StateCreator } from 'zustand'
import type { AppState } from '../../types'
import type { DiffComment } from '../../../../../shared/diff-comment-types'
import { createNonSecureContextUuid } from '../../../../../shared/non-secure-context-uuid'
import { isAiInstructionComment } from '@/lib/source-control/review/comments/diff-comment-compat'
import { enqueueDiffCommentPersist, mutateDiffComments } from './diff-comment-persistence'
import { readOwnedDiffComments, type DiffCommentOwner } from './diff-comment-owner'

/** One instruction handed to an agent, as the dispatching surface knows it. */
type AiInstructionDispatchRecord = {
  filePath: string
  lineNumber: number
  body: string
  selectedText?: string
  dispatchedPaneKey?: string
}

type AiInstructionDispatchOptions = {
  sentAt?: number
  /** The dispatched file's current instructions; records whose text left it are orphans. */
  currentInstructions?: readonly { lineNumber: number; instruction: string }[]
}

export type AiInstructionRecordActions = {
  /** Writes the record of every dispatched instruction and drops the file's orphans. */
  markAiInstructionsDispatched: (
    owner: DiffCommentOwner,
    records: readonly AiInstructionDispatchRecord[],
    options?: AiInstructionDispatchOptions
  ) => Promise<boolean>
  /** Stamps the dispatched records as done; they stay visible. */
  markAiInstructionsCompleted: (
    owner: DiffCommentOwner,
    recordIds: readonly string[],
    completedAt?: number
  ) => Promise<boolean>
}

/** The instruction records of the dispatched files whose text is no longer one of the file's instructions. */
function withoutOrphanInstructions(
  comments: DiffComment[],
  filePaths: ReadonlySet<string>,
  liveBodies: ReadonlySet<string>
): DiffComment[] {
  const kept = comments.filter(
    (comment) =>
      !(
        isAiInstructionComment(comment) &&
        filePaths.has(comment.filePath) &&
        !liveBodies.has(comment.body)
      )
  )
  return kept.length === comments.length ? comments : kept
}

export function createAiInstructionRecordActions(
  set: Parameters<StateCreator<AppState>>[0],
  get: () => AppState
): AiInstructionRecordActions {
  return {
    markAiInstructionsDispatched: async (owner, records, options) => {
      if (!readOwnedDiffComments(get(), owner)) {
        return false
      }
      const worktreeId = owner.worktreeId
      const now = Date.now()
      const sentAt = options?.sentAt ?? now
      const currentInstructions = options?.currentInstructions
      // Why: the instruction list covers the dispatched files, so records of other files stay untouched.
      const liveBodies = currentInstructions
        ? new Set(currentInstructions.map((entry) => entry.instruction))
        : null
      const dispatchedFilePaths = new Set(records.map((record) => record.filePath))
      const result = mutateDiffComments(set, owner, (existing) => {
        const kept = liveBodies
          ? withoutOrphanInstructions(existing, dispatchedFilePaths, liveBodies)
          : existing
        // Why: kept may be the copy's own array, so the upsert writes into a copy.
        const next = kept.slice()
        let changed = kept.length !== existing.length
        for (const record of records) {
          const index = next.findIndex(
            (comment) =>
              isAiInstructionComment(comment) &&
              comment.filePath === record.filePath &&
              comment.lineNumber === record.lineNumber &&
              comment.body === record.body
          )
          if (index === -1) {
            next.push({
              id: createNonSecureContextUuid(),
              worktreeId,
              filePath: record.filePath,
              source: 'ai-instruction',
              startLine: record.lineNumber,
              lineNumber: record.lineNumber,
              body: record.body,
              selectedText: record.selectedText,
              createdAt: now,
              sentAt,
              dispatchedPaneKey: record.dispatchedPaneKey,
              side: 'modified'
            })
            changed = true
            continue
          }
          const current = next[index]
          if (
            current.sentAt === sentAt &&
            current.completedAt === undefined &&
            current.selectedText === record.selectedText &&
            current.dispatchedPaneKey === record.dispatchedPaneKey
          ) {
            continue
          }
          next[index] = {
            ...current,
            sentAt,
            // Why: the work is in flight again, so the record is dispatched, not finished.
            completedAt: undefined,
            selectedText: record.selectedText,
            dispatchedPaneKey: record.dispatchedPaneKey
          }
          changed = true
        }
        return changed ? next : null
      })
      if (!result) {
        return true
      }
      try {
        await enqueueDiffCommentPersist(set, worktreeId, get, result)
        return true
      } catch (err) {
        console.error('Failed to persist diff comments:', err)
        return false
      }
    },

    markAiInstructionsCompleted: async (owner, recordIds, completedAt = Date.now()) => {
      if (!readOwnedDiffComments(get(), owner)) {
        return false
      }
      const worktreeId = owner.worktreeId
      if (recordIds.length === 0) {
        return true
      }
      const ids = new Set(recordIds)
      const result = mutateDiffComments(set, owner, (existing) => {
        let changed = false
        const next = existing.map((comment) => {
          if (
            !ids.has(comment.id) ||
            !isAiInstructionComment(comment) ||
            comment.completedAt === completedAt
          ) {
            return comment
          }
          changed = true
          return { ...comment, completedAt }
        })
        return changed ? next : null
      })
      if (!result) {
        return true
      }
      try {
        await enqueueDiffCommentPersist(set, worktreeId, get, result)
        return true
      } catch (err) {
        console.error('Failed to persist diff comments:', err)
        return false
      }
    }
  }
}
