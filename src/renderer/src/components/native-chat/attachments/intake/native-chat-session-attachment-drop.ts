import { basename } from '@/lib/path'
import { extractIpcErrorMessage } from '@/runtime/errors/ipc-error'
import { describeDropSkipReason } from '@/lib/files/drop/drop-skip-reason-copy'
import type { NativeChatAttachmentFocusOptions } from '../uploads/native-chat-resolved-path-ownership'
import { nativeChatAttachmentOwnerChangedNotice } from './native-chat-attachment-notices'
import { applyLandedAttachmentChips } from './native-chat-landed-attachment-chips'
import {
  prepareNativeChatSessionAttachmentUpload,
  uploadNativeChatSessionAttachmentPaths
} from '../uploads/native-chat-session-attachment-upload'
import type { NativeChatRuntimeSessionAttachmentOwner } from '../uploads/native-chat-attachment-owner'

export type NativeChatPendingAttachmentOptions = NativeChatAttachmentFocusOptions & {
  insertReferences?: ((paths: string[]) => void) | null
}

export type NativeChatPendingAttachmentChips = {
  begin: (previewUrl?: string, pendingName?: string) => string | null
  resolve: (
    id: string,
    path: string,
    connectionId?: string | null,
    options?: NativeChatPendingAttachmentOptions
  ) => boolean
  /** Removes the chip; false when the user already removed it, so its file must not attach. */
  drop: (id: string) => boolean
  /** Persist @path references in the draft through IME composition and remounts. */
  attachReferences: (
    references: { id: string; path: string }[],
    options?: NativeChatPendingAttachmentOptions
  ) => boolean
}

export type NativeChatReservedAttachment = { path: string; chipId: string }

/** One named pending chip per file; a path without one was refused and the composer said why. */
export function reserveNativeChatAttachmentChips(
  chips: NativeChatPendingAttachmentChips,
  paths: string[]
): NativeChatReservedAttachment[] {
  return paths.flatMap((path) => {
    const chipId = chips.begin(undefined, basename(path))
    return chipId ? [{ path, chipId }] : []
  })
}

/** Upload paired-server files behind pending chips; Send waits, and removed chips must never attach. */
export async function attachNativeChatSessionAttachmentPaths(args: {
  pending: NativeChatReservedAttachment[]
  owner: NativeChatRuntimeSessionAttachmentOwner
  chips: NativeChatPendingAttachmentChips
  options?: NativeChatAttachmentFocusOptions
  isAbandoned: () => boolean
  ownerStillCurrent: () => boolean
  setNotice: (notice: string | null) => void
}): Promise<void> {
  const { pending } = args
  if (pending.length === 0) {
    return
  }
  const dropAll = (): void => {
    for (const { chipId } of pending) {
      args.chips.drop(chipId)
    }
  }
  let stored: Map<string, string>
  let reasons: Map<string, string>
  try {
    const prepared = await prepareNativeChatSessionAttachmentUpload(args.owner)
    if (!prepared.ok) {
      dropAll()
      args.setNotice(prepared.notice)
      return
    }
    const result = await uploadNativeChatSessionAttachmentPaths(
      pending.map(({ path }) => path),
      prepared.target
    )
    stored = new Map(result.uploaded.map(({ sourcePath, path }) => [sourcePath, path]))
    reasons = new Map([
      ...result.skipped.map(({ sourcePath, reason }): [string, string] => [
        sourcePath,
        describeDropSkipReason(reason) ?? reason
      ]),
      ...result.failed.map(({ sourcePath, reason }): [string, string] => [sourcePath, reason])
    ])
  } catch (error) {
    stored = new Map()
    const cause = extractIpcErrorMessage(error, '')
    reasons = new Map(pending.map(({ path }) => [path, cause]))
  }
  if (args.isAbandoned()) {
    dropAll()
    return
  }
  if (!args.ownerStillCurrent()) {
    dropAll()
    args.setNotice(nativeChatAttachmentOwnerChangedNotice())
    return
  }
  applyLandedAttachmentChips({
    pending,
    landed: stored,
    reasons,
    chips: args.chips,
    options: args.options,
    setNotice: args.setNotice
  })
}
