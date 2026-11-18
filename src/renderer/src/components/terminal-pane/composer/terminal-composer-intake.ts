import { toast } from 'sonner'
import type { Translate } from '@/i18n/use-translate'
import {
  RUNTIME_IMPORT_CONNECTION_CHANGED_MESSAGE,
  RUNTIME_IMPORT_PAIRING_CHANGED_MESSAGE
} from '@/runtime/files/mutations/runtime-file-mutation-rpc'
import { TERMINAL_DROP_HOST_CHANGED_MESSAGE } from '../input/file-drop/terminal-drop-transport-owner'
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

/** Whether the rejection is the host fence's own: the host moved under the upload. */
function isHostChangedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : ''
  return (
    message === TERMINAL_DROP_HOST_CHANGED_MESSAGE ||
    message === RUNTIME_IMPORT_PAIRING_CHANGED_MESSAGE ||
    message === RUNTIME_IMPORT_CONNECTION_CHANGED_MESSAGE
  )
}

/**
 * Runs one attachment intake and lands what it brought.
 *
 * The host fence throws on purpose when the host moved under the upload, so that
 * rejection becomes an answer. Anything else is not the host's fault: the cause is
 * logged and the user is told the attachment failed.
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
  } catch (error) {
    if (isHostChangedError(error)) {
      toast.error(terminalComposerHostChangedWhileAttachingMessage(args.t))
    } else {
      console.error('[terminal-composer] the attachment failed', error)
      toast.error(args.t('terminalComposer.uploadFailed', 'Could not attach the file'))
    }
  } finally {
    args.setUploading(false)
  }
}
