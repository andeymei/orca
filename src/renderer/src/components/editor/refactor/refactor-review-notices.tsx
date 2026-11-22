import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'

import type { RefactorProposal } from '../../../../../shared/refactor/refactor-types'
import { failureLabel, type UnfinishedJobState } from './refactor-review-job-status'
import { refactorHunksOfProposal } from './refactor-review-store'

export type RefactorReviewNoticesProps = {
  /** The job, when it ended without proposals. */
  job: UnfinishedJobState | null
  planUnavailable: boolean
  /** The failure of the last write attempt, if it failed. */
  failure: string | null
  /** The files the runtime refused to write, and why. */
  refusals: { path: string; reason: string }[]
}

/** What the tab says about a job or a write that did not go through. */
export function RefactorReviewNotices({
  job,
  planUnavailable,
  failure,
  refusals
}: RefactorReviewNoticesProps): React.JSX.Element | null {
  const t = useTranslate()
  if (!job && !planUnavailable && !failure && refusals.length === 0) {
    return null
  }
  return (
    <>
      {job ? (
        <div className="border-b border-border px-3 py-2">
          <p
            className={
              job.state === 'failed'
                ? 'text-xs font-medium text-destructive'
                : 'text-xs font-medium'
            }
          >
            {failureLabel(job, t)}
          </p>
          {job.warnings.map((warning) => (
            <p key={warning} className="text-xs text-muted-foreground">
              {warning}
            </p>
          ))}
        </div>
      ) : null}
      {planUnavailable ? (
        <p className="border-b border-border px-3 py-2 text-xs text-destructive">
          {t(
            'auto.components.editor.RefactorReviewTab.planUnavailable',
            '未能读取重构建议，请重新生成。'
          )}
        </p>
      ) : null}
      {failure ? (
        <p className="border-b border-border px-3 py-2 text-xs text-destructive">{failure}</p>
      ) : null}
      {refusals.length > 0 ? (
        <div className="border-b border-border px-3 py-2">
          <p className="text-xs font-medium text-destructive">
            {t('auto.components.editor.RefactorReviewTab.refused', '部分文件没有被写入')}
          </p>
          {refusals.map((refusal) => (
            <div key={refusal.path} className="text-xs">
              <span className="font-mono text-muted-foreground">{refusal.path}</span>
              <p className="text-muted-foreground">{refusal.reason}</p>
            </div>
          ))}
        </div>
      ) : null}
    </>
  )
}

export type RefactorPartialAcceptanceNoticesProps = {
  /** The proposals the user accepted only part of. */
  proposals: RefactorProposal[]
  onAcceptWhole: (proposal: RefactorProposal) => void
}

/**
 * The proposals the user accepted only part of.
 *
 * Why a warning of its own: the hunks of one proposal can depend on each other, and accepting one
 * of them alone can leave code that does not compile.
 */
export function RefactorPartialAcceptanceNotices({
  proposals,
  onAcceptWhole
}: RefactorPartialAcceptanceNoticesProps): React.JSX.Element | null {
  const t = useTranslate()
  if (proposals.length === 0) {
    return null
  }
  return (
    <>
      {proposals.map((proposal) => (
        <div key={proposal.id} className="border-b border-border px-3 py-2">
          <p className="text-xs text-muted-foreground">
            {t(
              'auto.components.editor.RefactorReviewTab.partialAcceptance',
              '{{title}}：这个改动由 {{count}} 处修改共同组成，只接受其中一处可能无法编译',
              {
                title: proposal.title,
                count: refactorHunksOfProposal(proposal).length
              }
            )}
          </p>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="mt-1"
            onClick={() => onAcceptWhole(proposal)}
          >
            {t(
              'auto.components.editor.RefactorReviewTab.acceptWholeProposal',
              '接受该方案全部改动'
            )}
          </Button>
        </div>
      ))}
    </>
  )
}
