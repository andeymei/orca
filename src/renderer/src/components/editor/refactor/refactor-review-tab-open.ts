import { toast } from 'sonner'

import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store/index'
import { openWorkspaceEditorItem } from '@/store/slices/editor/tabs/workspace-editor-item'

import { getRefactorReviewLabel } from '../editor-labels'
import { proposeRefactor } from './refactor-runtime-client'

/**
 * The id of the review tab of a job.
 *
 * Why a synthetic id: the tab has no file on disk, and the id also owns the Monaco models of
 * every hunk the tab shows.
 */
export function refactorReviewTabId(worktreeId: string, jobId: string): string {
  return `${worktreeId}::refactor-review:${jobId}`
}

/**
 * Start a refactoring job and open its review tab.
 *
 * Why a failed start opens no tab: the tab would show nothing, and the user would read the empty
 * surface as a broken app instead of a refused request.
 */
export async function openRefactorReviewTab(input: {
  worktreeId: string
  relativePath: string
  content: string
  instruction?: string
}): Promise<void> {
  const outcome = await proposeRefactor(input)
  if (!('jobId' in outcome)) {
    // Why the runtime's own words: it knows whether the workspace was remote, the path unsafe or
    // the request lost, and the user has to act on that difference.
    toast.error(
      outcome.failure === 'refused'
        ? outcome.reason
        : translate(
            'auto.components.editor.RefactorReviewTab.proposeFailed',
            'The refactoring could not be started. Try again.'
          )
    )
    return
  }
  const jobId = outcome.jobId
  const state = useAppStore.getState()
  const id = refactorReviewTabId(input.worktreeId, jobId)
  // Why the marker: the strip and the Ctrl+Tab overlay both name this tab, and without one they
  // would read exactly like the file tab the refactoring ran on.
  const label = getRefactorReviewLabel(input.relativePath)
  const existing = state.unifiedTabsByWorktree?.[input.worktreeId]?.find(
    (tab) => tab.contentType === 'refactor-review' && tab.entityId === id
  )
  if (existing) {
    // Why the group: the tab may sit in another pane, and a new one would duplicate it.
    openWorkspaceEditorItem(
      state,
      id,
      input.worktreeId,
      label,
      'refactor-review',
      undefined,
      existing.groupId
    )
    return
  }
  state.openFile(
    {
      filePath: id,
      relativePath: input.relativePath,
      worktreeId: input.worktreeId,
      language: 'plaintext',
      mode: 'refactor-review',
      refactorReview: { jobId, worktreeId: input.worktreeId, relativePath: input.relativePath }
    },
    { reopenId: id, preview: false, tabLabel: label }
  )
}
