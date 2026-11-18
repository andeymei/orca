import { toast } from 'sonner'
import type { Translate } from '@/i18n/use-translate'
import type { TerminalComposerIntakeResult } from './attachments/terminal-composer-attachment-intake'

/** The host that owns the terminal cannot be reached, so nothing can land on it. */
export function terminalComposerHostUnavailableMessage(t: Translate): string {
  return t(
    'terminalComposer.hostUnavailable',
    "This terminal's host cannot be reached, so nothing was attached."
  )
}

/** The host moved under the upload, so the attachment never reached it. */
export function terminalComposerHostChangedWhileAttachingMessage(t: Translate): string {
  return t(
    'terminalComposer.hostChangedWhileAttaching',
    'The host changed, so nothing was attached. Try again.'
  )
}

/**
 * Runs one attachment intake and lands what it brought.
 *
 * The host fence throws on purpose when the host moved under the upload, so the
 * rejection has to become an answer: the composer never refuses silently, and the
 * draft stays as it was so the user can try again.
 */
export async function runTerminalComposerIntake(args: {
  intake: () => Promise<TerminalComposerIntakeResult>
  land: (result: TerminalComposerIntakeResult) => void
  setUploading: (uploading: boolean) => void
  t: Translate
}): Promise<void> {
  args.setUploading(true)
  try {
    args.land(await args.intake())
  } catch {
    toast.error(terminalComposerHostChangedWhileAttachingMessage(args.t))
  } finally {
    args.setUploading(false)
  }
}
