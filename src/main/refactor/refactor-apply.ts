import { applyRefactorHunks } from '../../shared/refactor/refactor-hunk-application'
import type {
  RefactorFileProposal,
  RefactorHunk,
  RefactorPlan
} from '../../shared/refactor/refactor-types'
import { getDiskBaselineSignature } from '../../shared/file-write/disk-baseline-signature'
import type { RefactorFileReadResult } from './refactor-file-reads'

export type RefactorApplyPrecondition = {
  expectedSignature: string
  allowMissing: boolean
}

export type RefactorApplySelectionInput = {
  plan: RefactorPlan
  /** The disk content of each file when the plan was built. */
  diskContents: ReadonlyMap<string, string>
  acceptedHunkIds: readonly string[]
  /** The file's current disk content, or why it could not be read. */
  readCurrent: (path: string) => Promise<RefactorFileReadResult>
  /** Writes the file unless the disk moved on; false means the write was refused. */
  write: (
    path: string,
    content: string,
    precondition: RefactorApplyPrecondition
  ) => Promise<boolean>
  /** Stops the remaining writes; a write already in flight cannot be un-written. */
  signal?: AbortSignal
}

export type RefactorApplySelectionResult = {
  applied: { path: string; hunksApplied: number }[]
  refusals: { path: string; reason: string }[]
}

const FILE_CHANGED_REASON = '文件在评审期间被改动过，请重新生成重构建议'
const FILE_MISSING_REASON = '文件已被删除'
const WRITE_FAILED_REASON = '写入失败'
const CANCELLED_REASON = '重构任务已取消，该文件未写入'

type FileSelection = {
  file: RefactorFileProposal
  hunks: RefactorHunk[]
}

/**
 * Groups the accepted hunks by the file they belong to.
 *
 * The hunk id is an opaque whole string (`src/a.ts:h1`): the accepted set is flat, so two files
 * that both numbered their first hunk `h1` would be accepted together. The tail is never parsed.
 */
function collectAcceptedFiles(plan: RefactorPlan, accepted: ReadonlySet<string>): FileSelection[] {
  const byPath = new Map<string, FileSelection>()
  for (const proposal of plan.proposals) {
    for (const file of proposal.files) {
      const hunks = file.hunks.filter((hunk) => accepted.has(hunk.id))
      if (hunks.length === 0) {
        continue
      }
      const existing = byPath.get(file.path)
      if (existing) {
        existing.hunks.push(...hunks)
        continue
      }
      byPath.set(file.path, { file, hunks: [...hunks] })
    }
  }
  return [...byPath.values()]
}

/**
 * Writes the accepted hunks of a plan back into the workspace.
 *
 * The refusal reasons travel with the result: a file the user changed during the review is not
 * overwritten, and the user has to be told why nothing happened.
 */
export async function applyRefactorSelection(
  input: RefactorApplySelectionInput
): Promise<RefactorApplySelectionResult> {
  const accepted = new Set(input.acceptedHunkIds)
  const applied: RefactorApplySelectionResult['applied'] = []
  const refusals: RefactorApplySelectionResult['refusals'] = []

  const selections = collectAcceptedFiles(input.plan, accepted)
  for (const [index, selection] of selections.entries()) {
    const { file, hunks } = selection
    const current = await input.readCurrent(file.path)
    if (current.status === 'missing') {
      refusals.push({ path: file.path, reason: FILE_MISSING_REASON })
      continue
    }
    if (current.status === 'unreadable') {
      refusals.push({ path: file.path, reason: current.reason })
      continue
    }
    const disk = input.diskContents.get(file.path)
    // Two readings pass: the disk may still hold the content the plan was built against (the
    // user never saved), or the user's saved baseline (the user saved during the review). Only
    // neither means somebody really changed the file.
    if (current.content !== disk && current.content !== file.originalContent) {
      refusals.push({ path: file.path, reason: FILE_CHANGED_REASON })
      continue
    }
    if (input.signal?.aborted === true) {
      // The task was cancelled: nothing new starts, and the files that were not written say so.
      for (const pending of selections.slice(index)) {
        refusals.push({ path: pending.file.path, reason: CANCELLED_REASON })
      }
      break
    }
    // The diff is against the baseline, so the refactored text starts from the baseline too.
    const newContent = applyRefactorHunks(file.originalContent, hunks)
    const written = await input.write(file.path, newContent, {
      // The precondition describes what was read from disk, not what is written into it.
      expectedSignature: getDiskBaselineSignature(current.content),
      allowMissing: false
    })
    if (!written) {
      refusals.push({ path: file.path, reason: WRITE_FAILED_REASON })
      continue
    }
    applied.push({ path: file.path, hunksApplied: hunks.length })
  }

  return { applied, refusals }
}
