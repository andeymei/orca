import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { fileOwnerUnresolvedMessage } from '@/lib/files/access/file-owner-runtime-target'
import { joinPath } from '@/lib/path'
import { recomputeOn } from '@/lib/recompute-on'
import { useFileOwnerRuntimeTarget } from '@/runtime/rpc/targets/use-worktree-runtime-target'
import { useAppStore } from '@/store/index'

import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import type { RefactorProposal } from '../../../../../shared/refactor/refactor-types'
import { RefactorHunkView } from './refactor-hunk-view'
import { pollRefactorJob } from './refactor-job-poller'
import { statusLabel, writtenLabel, type ReviewJobState } from './refactor-review-job-status'
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
  fetchRefactorStatus,
  RefactorApplyTimeoutError
} from './refactor-runtime-client'

export type RefactorReviewTabProps = {
  /** The job whose proposals the tab shows. */
  jobId: string
  /** The workspace the job runs in. */
  worktreeId: string
  /** The file the job was started on. */
  relativePath: string
  /** The runtime environment that owns the workspace; absent for a workspace of this machine. */
  runtimeEnvironmentId?: string | null
}

/** The review tab: the proposals on the left, the change under review on the right. */
export function RefactorReviewTab({
  jobId,
  worktreeId,
  relativePath,
  runtimeEnvironmentId
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
  // Why the owner: the job lives in the runtime that holds the workspace's files, so every
  // request about it has to go there and not to this app's runtime.
  const target = useFileOwnerRuntimeTarget(worktreeId, runtimeEnvironmentId)
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
      fetchStatus: (id) => fetchRefactorStatus(requireJobRuntime(target), id),
      onStatus: (status) => {
        if (cancelled) {
          return
        }
        setJob(status)
        if (status.state !== 'done' || refactorReviewStore.getPlan(jobId)) {
          return
        }
        void fetchRefactorPlan(requireJobRuntime(target), jobId).then((fetched) => {
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
    // Why the owner: the poll asks the runtime that holds the job, so it starts over when the
    // workspace's owner is known to be another runtime.
  }, [jobId, target])

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

  const closeTab = useCallback((): void => {
    useAppStore.getState().closeFile(ownerKey)
  }, [ownerKey])

  const write = async (hunkIds: string[]): Promise<void> => {
    setWriting(true)
    setFailure(null)
    setRefusals([])
    await runAndClear(
      async () => {
        try {
          const result = await applyRefactor(requireJobRuntime(target), jobId, hunkIds)
          if (result.refusals.length > 0) {
            // Why the tab stays open: the user has to read why a file was not written.
            setRefusals(result.refusals)
            return
          }
          if (result.applied.length === 0) {
            setFailure(
              t(
                'auto.components.editor.RefactorReviewTab.nothingWritten',
                'No changes were written. Start a new refactoring.'
              )
            )
            return
          }
          toast.success(writtenLabel(result.applied.length, t))
          // Why the order: the tab closes on success, so the release starts before the component
          // goes away.
          releaseRefactorJob(requireJobRuntime(target), jobId)
          closeTab()
        } catch (error) {
          const message = applyFailureMessage(error, t)
          setFailure(message)
          toast.error(message)
        }
      },
      () => setWriting(false)
    )
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
    await runAndClear(
      async () => {
        const discarded = await discardRefactor(requireJobRuntime(target), jobId)
        if (!discarded) {
          // Why the tab stays open: the job may still be running, and the user has to know.
          setFailure(
            t(
              'auto.components.editor.RefactorReviewTab.discardFailed',
              'The job could not be discarded and may still be running.'
            )
          )
          return
        }
        closeTab()
      },
      () => setDiscarding(false)
    )
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
              ? t('auto.components.editor.RefactorReviewTab.showHunk', 'Show the code block')
              : t('auto.components.editor.RefactorReviewTab.showFile', 'Show the whole file')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="xs"
            disabled={acceptedHunkIds.length === 0 || writing}
            onClick={() => void write(acceptedHunkIds)}
          >
            {t('auto.components.editor.RefactorReviewTab.applyAccepted', 'Apply accepted changes')}
          </Button>
          <Button
            type="button"
            variant="default"
            size="xs"
            disabled={writing || !plan}
            onClick={() => void acceptAll()}
          >
            {t('auto.components.editor.RefactorReviewTab.acceptAll', 'Accept all proposals')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={discarding}
            onClick={() => void discard()}
          >
            {t('auto.components.editor.RefactorReviewTab.discard', 'Discard')}
          </Button>
        </div>
      </div>
      <RefactorReviewNotices
        job={job}
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
                ? t(
                    'auto.components.editor.RefactorReviewTab.selectHunk',
                    'Select a code block to see the diff'
                  )
                : t(
                    'auto.components.editor.RefactorReviewTab.noProposals',
                    'No proposals to review yet'
                  )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

/**
 * Runs the work and clears the flag afterwards, even when the work throws.
 *
 * Why it is not a component function: the React Compiler cannot compile a try statement with a
 * finalizer inside a component, and the flag has to be cleared even when the work fails.
 */
async function runAndClear(work: () => Promise<void>, clear: () => void): Promise<void> {
  try {
    await work()
  } finally {
    clear()
  }
}

/**
 * Releases a finished job and the scratch tree it wrote.
 *
 * Why it is not awaited: the tab closes on success, and the release has to start before the
 * component goes away. `discardRefactor` answers false instead of throwing, so the call cannot be
 * lost and cannot leave an unhandled rejection behind.
 */
function releaseRefactorJob(target: RuntimeClientTarget, jobId: string): void {
  void discardRefactor(target, jobId).then((discarded) => {
    if (!discarded) {
      console.error('[refactor] The finished job could not be released.')
    }
  })
}

/**
 * The runtime that holds the job, or a refusal.
 *
 * Why: the rows disagree on who owns the workspace, so no runtime can be named for it and every
 * request about the job would go nowhere.
 */
function requireJobRuntime(target: RuntimeClientTarget | null): RuntimeClientTarget {
  if (!target) {
    throw new Error(fileOwnerUnresolvedMessage())
  }
  return target
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

/**
 * What the tab says when a write did not finish.
 *
 * Why the timeout has its own words: the runtime stops starting further writes when the request
 * is cancelled, so the files it never reached do not come back — the user has to be told that the
 * outcome is unknown, not that the write failed.
 */
function applyFailureMessage(error: unknown, t: Translate): string {
  if (error instanceof RefactorApplyTimeoutError) {
    return t(
      'auto.components.editor.RefactorReviewTab.applyTimedOut',
      'The refactoring timed out. Some of the changes may have been written; check the files before trying again.'
    )
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }
  return t(
    'auto.components.editor.RefactorReviewTab.writeFailed',
    'The changes could not be written. Try again.'
  )
}
