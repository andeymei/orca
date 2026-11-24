import { basename } from '@/lib/path'
import { isImageDropPath } from '../../../../../../shared/terminal/input/image-path-paste'
import { stageNativeChatDraftFile } from '../../drafts/native-chat-draft-attachment-staging'
import { nativeChatPendingAttachmentScope } from '../chips/native-chat-pending-attachment-scopes'
import { nativeChatAttachFailedNotice } from './native-chat-attachment-notices'
import type { NativeChatAttachmentFocusOptions } from '../uploads/native-chat-resolved-path-ownership'
import type {
  NativeChatPendingAttachmentChips,
  NativeChatReservedAttachment
} from './native-chat-session-attachment-drop'

/**
 * Show the files that landed where the agent will read them: an image as a chip, any other
 * file as a reference to the path it landed at. A file that did not land is reported.
 */
export function applyLandedAttachmentChips(args: {
  pending: NativeChatReservedAttachment[]
  /** The path each source landed at, by its source path. */
  landed: Map<string, string>
  /** Why a source did not land, by its source path. */
  reasons: Map<string, string>
  chips: NativeChatPendingAttachmentChips
  options?: NativeChatAttachmentFocusOptions
  /** The draft that owns the files until the chat behind it can receive them. */
  stagingScope?: string
  setNotice: (notice: string | null) => void
}): void {
  const { pending, landed, reasons, chips } = args
  const notAttached: { name: string; reason: string }[] = []
  const references: { id: string; path: string }[] = []
  for (const { path, chipId } of pending) {
    const landedPath = landed.get(path)
    if (!landedPath) {
      if (chips.drop(chipId)) {
        notAttached.push({ name: basename(path), reason: reasons.get(path) ?? '' })
      }
      continue
    }
    if (isImageDropPath(landedPath)) {
      if (chips.resolve(chipId, landedPath, undefined, args.options)) {
        stageLandedFile(args.stagingScope, chipId, landedPath)
      }
      continue
    }
    references.push({ id: chipId, path: landedPath })
  }
  // Insertions clear notices, so report failures afterward.
  if (references.length > 0) {
    if (chips.attachReferences(references, args.options)) {
      references.forEach(({ id, path }) => stageLandedFile(args.stagingScope, id, path))
    }
  }
  if (notAttached.length > 0) {
    const [first] = notAttached
    const shared = notAttached.every(({ reason }) => reason === first?.reason) ? first.reason : ''
    args.setNotice(
      nativeChatAttachFailedNotice(
        notAttached.map(({ name }) => name),
        shared
      )
    )
  }
}

/** A draft that cannot send yet owns the file until the chat behind it can receive it. */
function stageLandedFile(stagingScope: string | undefined, chipId: string, path: string): void {
  if (!stagingScope) {
    return
  }
  stageNativeChatDraftFile(nativeChatPendingAttachmentScope(stagingScope, chipId), path)
}
