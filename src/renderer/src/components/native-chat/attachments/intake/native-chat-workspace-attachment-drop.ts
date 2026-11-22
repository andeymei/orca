import { landWorkspaceAttachments } from '@/runtime/files/imports/workspace-attachment-landing'
import { applyLandedAttachmentChips } from './native-chat-landed-attachment-chips'
import type { NativeChatAttachmentLandingTarget } from '../uploads/native-chat-attachment-landing-target'
import type { NativeChatAttachmentFocusOptions } from '../uploads/native-chat-resolved-path-ownership'
import type {
  NativeChatPendingAttachmentChips,
  NativeChatReservedAttachment
} from './native-chat-session-attachment-drop'

/**
 * Copy the reserved files into the workspace that owns the chat and attach the paths they
 * landed at. The agent reads them from the workspace, so the copy is what the prompt names.
 */
export async function attachNativeChatWorkspaceAttachmentPaths(args: {
  pending: NativeChatReservedAttachment[]
  target: NativeChatAttachmentLandingTarget
  chips: NativeChatPendingAttachmentChips
  options?: NativeChatAttachmentFocusOptions
  /** The draft that owns the files until the chat behind it can receive them. */
  stagingScope?: string
  isAbandoned: () => boolean
  ownerStillCurrent: () => boolean
  setNotice: (notice: string | null) => void
}): Promise<void> {
  const { pending, target, chips } = args
  if (pending.length === 0) {
    return
  }
  const dropAll = (): void => {
    for (const { chipId } of pending) {
      chips.drop(chipId)
    }
  }
  let landed: Map<string, string>
  let reasons: Map<string, string>
  try {
    const result = await landWorkspaceAttachments({
      sourcePaths: pending.map(({ path }) => path),
      workspacePath: target.workspacePath,
      worktreeId: target.worktreeId,
      runtimeEnvironmentId: target.runtimeEnvironmentId,
      connectionId: target.connectionId,
      expectedExecutionHostId: target.expectedExecutionHostId,
      expectedSshTargetId: target.expectedSshTargetId,
      expectedSshConnectionGeneration: target.expectedSshConnectionGeneration
    })
    landed = new Map(
      result.copied.map(({ sourcePath, workspacePath }) => [sourcePath, workspacePath])
    )
    reasons = new Map([
      ...result.skipped.map(({ sourcePath, reason }): [string, string] => [sourcePath, reason]),
      ...result.failed.map(({ sourcePath, reason }): [string, string] => [sourcePath, reason])
    ])
  } catch (error) {
    landed = new Map()
    reasons = new Map(
      pending.map(({ path }) => [path, error instanceof Error ? error.message : String(error)])
    )
  }
  if (args.isAbandoned()) {
    dropAll()
    return
  }
  if (!args.ownerStillCurrent()) {
    dropAll()
    return
  }
  applyLandedAttachmentChips({
    pending,
    landed,
    reasons,
    chips,
    options: args.options,
    stagingScope: args.stagingScope,
    setNotice: args.setNotice
  })
}
