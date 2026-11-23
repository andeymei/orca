import { nativeChatWorktreeNotReadyNotice } from '../attachments/intake/native-chat-attachment-notices'
import { nativeChatAttachmentOwnerUnchanged } from '../attachments/uploads/native-chat-resolved-path-ownership'
import type { NativeChatAttachmentOwner } from '../attachments/uploads/native-chat-attachment-owner'

/**
 * Settle the image operation started at paste time, or attach it directly when the paste
 * reserved no chip for it.
 */
export function settleNativeChatImagePaste(args: {
  pendingId: string | null
  path: string
  /** The owner the paste was taken under; the chat may have changed hosts since. */
  originalOwner: NativeChatAttachmentOwner
  currentOwner: NativeChatAttachmentOwner
  /** Drops the paste's pending record, so a settled image is not settled twice. */
  releasePending: (pendingId: string) => void
  dropImagePaste: (pendingId: string | null) => void
  resolvePendingImageAttachment: (id: string, path: string, connectionId?: string | null) => void
  attachResolvedPaths: (paths: string[], connectionId?: string | null) => void
  setNotice: (notice: string) => void
}): void {
  const { pendingId, path, originalOwner, currentOwner } = args
  if (!nativeChatAttachmentOwnerUnchanged(originalOwner, currentOwner)) {
    args.dropImagePaste(pendingId)
    args.setNotice(nativeChatWorktreeNotReadyNotice())
    return
  }
  if (pendingId) {
    args.releasePending(pendingId)
    args.resolvePendingImageAttachment(pendingId, path, null)
  } else {
    args.attachResolvedPaths([path], null)
  }
}
