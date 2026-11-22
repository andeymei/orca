import {
  resolveNativeChatAttachmentOwner,
  resolveNativeChatAttachmentOwnerForWorktree,
  resolveNativeChatRuntimeSessionAttachmentOwner,
  type NativeChatAttachmentOwner,
  type NativeChatStructuredAttachmentSession
} from './native-chat-attachment-owner'
import type { AppState } from '../../../../store/types'

/** The workspace a composer behind these attachments sits in. */
export type NativeChatComposerWorkspace = {
  structuredWorktreeId?: string
  terminalTabId: string
  structuredSession?: NativeChatStructuredAttachmentSession
}

/**
 * The owner of the chat a composer writes to: the structured session behind it, else the
 * workspace it sits in.
 */
export function resolveNativeChatComposerAttachmentOwner(
  state: AppState,
  workspace: NativeChatComposerWorkspace
): NativeChatAttachmentOwner {
  const { structuredWorktreeId, structuredSession, terminalTabId } = workspace
  if (structuredSession?.attachmentStagingScope) {
    return {
      kind: 'local',
      structuredSessionId: structuredSession.sessionId,
      stagingScope: structuredSession.attachmentStagingScope
    }
  }
  if (structuredWorktreeId && structuredSession?.runtimeEnvironmentId) {
    if (structuredSession.sessionPending) {
      return { kind: 'not-ready', notice: structuredSession.sessionPendingNotice }
    }
    return resolveNativeChatRuntimeSessionAttachmentOwner({
      sessionId: structuredSession.sessionId,
      runtimeEnvironmentId: structuredSession.runtimeEnvironmentId
    })
  }
  if (!structuredWorktreeId) {
    return resolveNativeChatAttachmentOwner(state, terminalTabId)
  }
  const owner = resolveNativeChatAttachmentOwnerForWorktree(state, structuredWorktreeId)
  return owner.kind === 'local' && structuredSession
    ? { kind: 'local', structuredSessionId: structuredSession.sessionId }
    : owner
}
