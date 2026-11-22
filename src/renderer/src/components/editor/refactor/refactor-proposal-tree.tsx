import { ChevronRight } from 'lucide-react'
import { useCallback, useSyncExternalStore } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useTranslate } from '@/i18n/use-translate'
import { recomputeOn } from '@/lib/recompute-on'

import type {
  RefactorFileProposal,
  RefactorHunk,
  RefactorProposal
} from '../../../../../shared/refactor/refactor-types'
import { refactorHunksOfProposal, refactorReviewStore } from './refactor-review-store'

export type RefactorProposalTreeProps = {
  /** The job whose plan the tree shows. */
  jobId: string
}

/** The review tree: a proposal, the files it touches, and the hunks of each file. */
export function RefactorProposalTree({
  jobId
}: RefactorProposalTreeProps): React.JSX.Element | null {
  const subscribe = useCallback(
    (listener: () => void) => refactorReviewStore.subscribe(jobId, listener),
    [jobId]
  )
  const plan = useSyncExternalStore(subscribe, () => refactorReviewStore.getPlan(jobId))
  const revision = useSyncExternalStore(subscribe, () => refactorReviewStore.getRevision(jobId))
  const selection = recomputeOn([revision], () => refactorReviewStore.getSelection(jobId))

  if (!plan) {
    return null
  }

  return (
    <div className="flex flex-col gap-2 p-2">
      {plan.proposals.map((proposal) => (
        <ProposalNode
          key={proposal.id}
          proposal={proposal}
          jobId={jobId}
          acceptedHunkIds={selection.acceptedHunkIds}
        />
      ))}
    </div>
  )
}

function ProposalNode({
  proposal,
  jobId,
  acceptedHunkIds
}: {
  proposal: RefactorProposal
  jobId: string
  acceptedHunkIds: Set<string>
}): React.JSX.Element {
  const t = useTranslate()
  const hunks = refactorHunksOfProposal(proposal)
  const hunkIds = hunks.map((hunk) => hunk.id)
  const rationale = proposal.rationale.trim()
  const acceptLabel = t(
    'auto.components.editor.RefactorProposalTree.acceptProposal',
    'Accept proposal {{title}}',
    { title: proposal.title }
  )
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        className="mt-1"
        checked={acceptanceOf(hunks, acceptedHunkIds)}
        onCheckedChange={(next) =>
          refactorReviewStore.setHunkSelection(jobId, hunkIds, next === true)
        }
        // Why: two proposals can carry the same title, so the id is what tells their boxes apart.
        aria-label={`${acceptLabel} · ${proposal.id}`}
      />
      <div className="min-w-0 flex-1 py-1">
        <Collapsible defaultOpen>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="group h-auto w-full items-start justify-start text-left"
            >
              <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium" title={proposal.title}>
                  {proposal.title}
                </span>
                <span
                  className="block truncate text-xs text-muted-foreground"
                  title={rationale.length > 0 ? rationale : undefined}
                >
                  {rationale.length > 0
                    ? rationale
                    : t(
                        'auto.components.editor.RefactorProposalTree.noRationale',
                        'No reason given'
                      )}
                </span>
              </span>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-1 flex flex-col gap-1">
              {proposal.files.map((file) => (
                <FileNode
                  key={file.path}
                  file={file}
                  jobId={jobId}
                  acceptedHunkIds={acceptedHunkIds}
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  )
}

function FileNode({
  file,
  jobId,
  acceptedHunkIds
}: {
  file: RefactorFileProposal
  jobId: string
  acceptedHunkIds: Set<string>
}): React.JSX.Element {
  const t = useTranslate()
  const hunks = file.hunks
  const hunkIds = hunks.map((hunk) => hunk.id)
  return (
    <div className="ml-4 flex items-start gap-2">
      <Checkbox
        className="mt-1"
        checked={acceptanceOf(hunks, acceptedHunkIds)}
        onCheckedChange={(next) =>
          refactorReviewStore.setHunkSelection(jobId, hunkIds, next === true)
        }
        aria-label={t(
          'auto.components.editor.RefactorProposalTree.acceptFile',
          'Accept file {{path}}',
          { path: file.path }
        )}
      />
      <div className="min-w-0 flex-1 py-0.5">
        <Collapsible defaultOpen>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="group h-auto w-full items-center justify-start text-left"
            >
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{file.path}</span>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="flex flex-col gap-0.5">
              {hunks.map((hunk, index) => (
                <HunkNode
                  key={hunk.id}
                  hunk={hunk}
                  filePath={file.path}
                  index={index}
                  jobId={jobId}
                  accepted={acceptedHunkIds.has(hunk.id)}
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  )
}

function HunkNode({
  hunk,
  filePath,
  index,
  jobId,
  accepted
}: {
  hunk: RefactorHunk
  filePath: string
  index: number
  jobId: string
  accepted: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const position = String(index + 1)
  return (
    <div className="ml-4 flex items-center gap-2">
      <Checkbox
        checked={accepted}
        onCheckedChange={() => refactorReviewStore.toggleHunk(jobId, hunk.id)}
        aria-label={t(
          'auto.components.editor.RefactorProposalTree.acceptHunk',
          'Accept code block {{index}} of {{path}}',
          { path: filePath, index: position }
        )}
      />
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => showHunk(jobId, hunk.id, filePath)}
      >
        {t('auto.components.editor.RefactorProposalTree.hunkLabel', 'Code block {{index}}', {
          index: position
        })}
      </Button>
    </div>
  )
}

/** What a node's checkbox shows: all of its hunks accepted, some of them, or none. */
function acceptanceOf(
  hunks: RefactorHunk[],
  acceptedHunkIds: Set<string>
): boolean | 'indeterminate' {
  if (hunks.length === 0) {
    return false
  }
  const acceptedCount = hunks.filter((hunk) => acceptedHunkIds.has(hunk.id)).length
  if (acceptedCount === 0) {
    return false
  }
  return acceptedCount === hunks.length ? true : 'indeterminate'
}

/** Points the right pane at one hunk, keeping what the user already accepted. */
function showHunk(jobId: string, hunkId: string, filePath: string): void {
  const selection = refactorReviewStore.getSelection(jobId)
  refactorReviewStore.setSelection(jobId, {
    acceptedHunkIds: selection.acceptedHunkIds,
    selectedHunkId: hunkId,
    selectedFilePath: filePath
  })
}
