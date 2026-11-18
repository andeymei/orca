import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { createOsFileDropSequence, useOsFileDropOwner } from '@/hooks/use-os-file-drop-owner'
import { getNativeFileDropRejectionMessage } from '@/lib/files/drop/native-file-drop-rejection-message'

type TerminalComposerFileDropArgs = {
  /** Whether the host that owns this terminal can still take the attachment. */
  canAccept: () => boolean
  /** The paths the drop carried. */
  onPaths: (paths: readonly string[]) => void
}

/**
 * The composer's card is a nested OS file drop owner.
 *
 * The pane that hosts the composer claims OS drops first and stops them in the capture phase,
 * so a React drop handler on the card never sees one. Only the nearest registered root takes a
 * drop, and the card sits inside the pane's container: registering it is what gives the composer
 * the drop the pane would otherwise swallow.
 */
export function useTerminalComposerFileDrop(
  args: TerminalComposerFileDropArgs
): (root: HTMLElement | null) => void {
  const ownerRef = useRef<HTMLElement | null>(null)
  const [sequence] = useState(createOsFileDropSequence)
  return useOsFileDropOwner(ownerRef, {
    consumer: 'agent',
    sequence,
    canAccept: args.canAccept,
    onDrop: async (prepared) => {
      for (const failure of prepared.failures) {
        const message = getNativeFileDropRejectionMessage(failure)
        toast.error(message.title, { description: message.description })
      }
      args.onPaths(prepared.paths)
    }
  })
}
