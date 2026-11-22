import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { joinPath } from '@/lib/path'
import { recomputeOn } from '@/lib/recompute-on'
import { useAppStore } from '@/store/index'

import type { RefactorProposal } from '../../../../../shared/refactor/refactor-types'
import { RefactorHunkView } from './refactor-hunk-view'
import { pollRefactorJob } from './refactor-job-poller'
import { statusLabel, unfinishedJob, type ReviewJobState } from './refactor-review-job-status'
import { RefactorPartialAcceptanceNotices, RefactorReviewNotices } from './refactor-review-notices'
import { findHunk, firstHunkOf, partiallyAcceptedProposals } from './refactor-review-plan-selection'
import { refactorHunksOfProposal, refactorReviewStore } from './refactor-review-store'
import { refactorReviewTabId } from './refactor-review-tab-open'
import { RefactorWholeFile } from './refactor-review-whole-file'
import { RefactorProposalTree } from './refactor-proposal-tree'
import {
  applyRefactor,
  discardRefactor,
  fetchRefactorPlan,
  fetchRefactorStatus
} from './refactor-runtime-client'

export type RefactorReviewTabProps = {
  /** The job whose proposals the tab shows. */
  jobId: string
  /** The workspace the job runs in. */
  worktreeId: string
  /** The file the job was started on. */
  relativePath: string
}

/** The review tab: the proposals on the left, the change under review on the right. */
export function RefactorReviewTab({
  jobId,
  worktreeId,
  relativePath
}: RefactorReviewTabProps): React.JSX.Element {
  const t = useTranslate()
  const ownerKey = refactorReviewTabId(worktreeId, jobId)
  const [job, setJob] = useState<ReviewJobState | null>(null)
  const [planUnavailable, setPlanUnavailable] = useState(false)
  const [refusals, setRefusals] = useState<{ path: string; reason: string }[]>([])
  const [failure, setFailure] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [wholeFile, setWholeFile] = useState(false)
  const sideBySide = useAppStore((state) => state.settings?.diffDefaultView === 'side-by-side')
  // Why the workspace root: the diff viewers resolve a file against the workspace, so they need
  // the absolute path, not the path the plan names.
  const workspaceRoot = useAppStore((state) => state.getKnownWorktreeById(worktreeId)?.path)

  const subscribe = useCallback(
    (listener: () => void) => refactorReviewStore.subscribe(jobId, listener),
    [jobId]
  )
  const plan = useSyncExternalStore(subscribe, () => refactorReviewStore.getPlan(jobId))
  const revision = useSyncExternalStore(subscribe, () => refactorReviewStore.getRevision(jobId))
  const selection = recomputeOn([revision], () => refactorReviewStore.getSelection(jobId))

  useEffect(() => {
    let cancelled = false
    const stop = pollRefactorJob({
      jobId,
      fetchStatus: fetchRefactorStatus,
      onStatus: (status) => {
        if (cancelled) {
          return
        }
        setJob(status)
        if (status.state !== 'done' || refactorReviewStore.getPlan(jobId)) {
          return
        }
        void fetchRefactorPlan(jobId).then((fetched) => {
          if (cancelled) {
            return
          }
          if (!fetched) {
            setPlanUnavailable(true)
            return
          }
          refactorReviewStore.setPlan(jobId, fetched)
        })
      }
    })
    return () => {
      cancelled = true
      stop()
      // Why: the editor panel unmounts the tab when the user looks away, and the plan has to
      // survive that. Only a closed tab drops the plan.
      const stillOpen = useAppStore
        .getState()
        .openFiles.some((file) => file.refactorReview?.jobId === jobId)
      if (!stillOpen) {
        refactorReviewStore.remove(jobId)
      }
    }
  }, [jobId])

  useEffect(() => {
    if (!plan) {
      return
    }
    const current = refactorReviewStore.getSelection(jobId)
    if (current.selectedHunkId) {
      return
    }
    const first = firstHunkOf(plan)
    if (!first) {
      return
    }
    // Why: the right pane opens on the first change, so the tab never shows an empty surface.
    refactorReviewStore.setSelection(jobId, {
      acceptedHunkIds: current.acceptedHunkIds,
      selectedHunkId: first.hunk.id,
      selectedFilePath: first.file.path
    })
  }, [plan, revision, jobId])

  // Why no memo: the store hands out a fresh selection every render, so a memo would never hit.
  const selected = plan ? findHunk(plan, selection.selectedHunkId) : null
  const partiallyAccepted = plan ? partiallyAcceptedProposals(plan, selection.acceptedHunkIds) : []
  const acceptedHunkIds = [...selection.acceptedHunkIds]
  const headerStatus = statusLabel(job, plan, t)
  const unfinished = unfinishedJob(job)

  const closeTab = useCallback((): void => {
    useAppStore.getState().closeFile(ownerKey)
  }, [ownerKey])

  const write = async (hunkIds: string[]): Promise<void> => {
    setWriting(true)
    setFailure(null)
    setRefusals([])
    try {
      const result = await applyRefactor(jobId, hunkIds)
      if (result.refusals.length > 0) {
        // Why the tab stays open: the user has to read why a file was not written.
        setRefusals(result.refusals)
        return
      }
      if (result.applied.length === 0) {
        setFailure(
          t(
            'auto.components.editor.RefactorReviewTab.nothingWritten',
            '没有改动被写入，请重新生成。'
          )
        )
        return
      }
      toast.success(
        t('auto.components.editor.RefactorReviewTab.written', '已写入 {{count}} 个文件', {
          count: result.applied.length
        })
      )
      closeTab()
    } catch (error) {
      setFailure(
        error instanceof Error && error.message.length > 0
          ? error.message
          : t('auto.components.editor.RefactorReviewTab.writeFailed', '写入失败，请重试。')
      )
      toast.error(t('auto.components.editor.RefactorReviewTab.writeFailed', '写入失败，请重试。'))
    } finally {
      setWriting(false)
    }
  }

  const acceptAll = async (): Promise<void> => {
    if (!plan) {
      return
    }
    const hunkIds = plan.proposals.flatMap((proposal) =>
      refactorHunksOfProposal(proposal).map((hunk) => hunk.id)
    )
    // Why: the store holds the accepted set, so the tree shows what the button did.
    refactorReviewStore.setHunkSelection(jobId, hunkIds, true)
    await write(hunkIds)
  }

  const acceptWholeProposal = (proposal: RefactorProposal): void => {
    refactorReviewStore.setHunkSelection(
      jobId,
      refactorHunksOfProposal(proposal).map((hunk) => hunk.id),
      true
    )
  }

  const discard = async (): Promise<void> => {
    setDiscarding(true)
    try {
      const discarded = await discardRefactor(jobId)
      if (!discarded) {
        // Why the tab stays open: the job may still be running, and the user has to know.
        setFailure(
          t(
            'auto.components.editor.RefactorReviewTab.discardFailed',
            '未能丢弃，重构任务可能仍在运行。'
          )
        )
        return
      }
      closeTab()
    } finally {
      setDiscarding(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="truncate font-mono text-xs text-muted-foreground">{relativePath}</span>
        {headerStatus ? (
          <span className="text-xs text-muted-foreground">{headerStatus}</span>
        ) : null}
        {job?.progress ? (
          <span className="truncate text-xs text-muted-foreground">{job.progress}</span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-pressed={wholeFile}
            disabled={!selected}
            onClick={() => setWholeFile((previous) => !previous)}
          >
            {wholeFile
              ? t('auto.components.editor.RefactorReviewTab.showHunk', '查看代码块')
              : t('auto.components.editor.RefactorReviewTab.showFile', '查看完整文件')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="xs"
            disabled={acceptedHunkIds.length === 0 || writing}
            onClick={() => void write(acceptedHunkIds)}
          >
            {t('auto.components.editor.RefactorReviewTab.applyAccepted', '应用已接受')}
          </Button>
          <Button
            type="button"
            variant="default"
            size="xs"
            disabled={writing}
            onClick={() => void acceptAll()}
          >
            {t('auto.components.editor.RefactorReviewTab.acceptAll', '接受全部方案')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={discarding}
            onClick={() => void discard()}
          >
            {t('auto.components.editor.RefactorReviewTab.discard', '丢弃')}
          </Button>
        </div>
      </div>
      <RefactorReviewNotices
        job={unfinished}
        planUnavailable={planUnavailable}
        failure={failure}
        refusals={refusals}
      />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-r border-border scrollbar-sleek">
          <RefactorPartialAcceptanceNotices
            proposals={partiallyAccepted}
            onAcceptWhole={acceptWholeProposal}
          />
          <RefactorProposalTree jobId={jobId} />
        </aside>
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selected ? (
            wholeFile ? (
              <RefactorWholeFile
                file={selected.file}
                filePath={workspaceFilePath(workspaceRoot, selected.file.path)}
                ownerKey={ownerKey}
                sideBySide={sideBySide}
              />
            ) : (
              <RefactorHunkView
                hunk={selected.hunk}
                filePath={workspaceFilePath(workspaceRoot, selected.file.path)}
                relativePath={selected.file.path}
                ownerKey={ownerKey}
                accepted={selection.acceptedHunkIds.has(selected.hunk.id)}
                sideBySide={sideBySide}
                onToggleAccepted={() => refactorReviewStore.toggleHunk(jobId, selected.hunk.id)}
              />
            )
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
              {plan
                ? t('auto.components.editor.RefactorReviewTab.selectHunk', '选择一个代码块查看差异')
                : t(
                    'auto.components.editor.RefactorReviewTab.noProposals',
                    '还没有可审查的重构建议'
                  )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

/**
 * The absolute path of a workspace file.
 *
 * Why absolute: the diff viewers resolve a file against the workspace root, and the plan names
 * files relative to it.
 */
function workspaceFilePath(workspaceRoot: string | undefined, relativePath: string): string {
  return workspaceRoot ? joinPath(workspaceRoot, relativePath) : relativePath
}
