import { FileX, Hourglass, X } from 'lucide-react'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import type { TerminalComposerAttachment } from '@/store/slices/terminal-composer/terminal-composer'

export type TerminalComposerAttachmentStatusProps = {
  /** Whether an upload is still on its way to the host that owns the terminal. */
  uploading: boolean
  /** The draft's attachment records; the ones that failed say why. */
  attachments: readonly TerminalComposerAttachment[]
  /** Drops one failed attachment from the draft. */
  onDismiss: (attachmentId: string) => void
}

/** The uploads on their way and the ones that did not land. */
export function TerminalComposerAttachmentStatus({
  uploading,
  attachments,
  onDismiss
}: TerminalComposerAttachmentStatusProps): React.JSX.Element | null {
  const t = useTranslate()
  const failed = attachments.filter((attachment) => attachment.failed === true)
  if (!uploading && failed.length === 0) {
    return null
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {uploading ? (
        <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-xs text-muted-foreground">
          <Hourglass className="size-3" />
          <LoadingSpinner className="size-3" />
          {t('terminalComposer.uploading', 'Uploading…')}
        </span>
      ) : null}
      {failed.map((attachment) => {
        const reason = attachmentReasonText(attachment.reason ?? '', t)
        return (
          <span
            key={attachment.id}
            className="inline-flex max-w-72 items-center gap-1 rounded-md border border-dashed border-border px-1.5 py-0.5 text-xs text-muted-foreground"
          >
            <FileX className="size-3 shrink-0" />
            <span className="truncate">{attachment.name}</span>
            {reason ? <span className="truncate">{reason}</span> : null}
            <span className="shrink-0">{t('terminalComposer.attachAgain', 'Attach it again')}</span>
            <button
              type="button"
              aria-label={t('terminalComposer.dismissFailed', 'Dismiss the failed attachment')}
              className="shrink-0 rounded-sm p-0.5 hover:bg-accent hover:text-accent-foreground"
              onClick={() => onDismiss(attachment.id)}
            >
              <X className="size-3" />
            </button>
          </span>
        )
      })}
    </div>
  )
}

/** The intake reports machine codes for some failures and a sentence for others. */
export function attachmentReasonText(reason: string, t: Translate): string {
  switch (reason) {
    case 'missing':
      return t('terminalComposer.reasonMissing', 'The file is gone')
    case 'symlink':
      return t('terminalComposer.reasonSymlink', 'That path is a link, not a file')
    case 'permission-denied':
      return t('terminalComposer.reasonPermissionDenied', 'No permission to read the file')
    case 'unsupported':
      return t('terminalComposer.reasonUnsupported', 'That kind of file cannot be attached')
    case 'no-local-path':
      return t('terminalComposer.reasonNoLocalPath', 'The pasted item has no file behind it')
    default:
      // A reason that is already a sentence is shown as it came.
      return reason
  }
}
