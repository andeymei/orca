import { describe, expect, it } from 'vitest'
import { nativeChatAttachmentLandingTargetFor } from './native-chat-attachment-landing-target'
import type { NativeChatAttachmentLandingTarget } from './native-chat-attachment-landing-target'
import type { NativeChatAttachmentOwner } from './native-chat-attachment-owner'

const localTarget: NativeChatAttachmentLandingTarget = {
  worktreeId: 'worktree-1',
  workspacePath: '/ws',
  runtimeEnvironmentId: null,
  connectionId: null,
  expectedExecutionHostId: 'local'
}

const pairedTarget: NativeChatAttachmentLandingTarget = {
  worktreeId: 'worktree-2',
  workspacePath: '/remote/ws',
  runtimeEnvironmentId: 'env-1',
  connectionId: null,
  expectedExecutionHostId: 'local'
}

describe('the native chat attachment landing target', () => {
  it('lands a local chat in the workspace this machine owns', () => {
    expect(nativeChatAttachmentLandingTargetFor({ kind: 'local' }, localTarget)).toBe(localTarget)
  })

  it('keeps a local chat off a workspace a paired server owns', () => {
    expect(nativeChatAttachmentLandingTargetFor({ kind: 'local' }, pairedTarget)).toBeNull()
  })

  it('lands a paired chat in the workspace its own server owns', () => {
    const owner: NativeChatAttachmentOwner = {
      kind: 'runtime-session',
      environmentId: 'env-1',
      pairingRevision: 1,
      sessionId: 'session-1'
    }

    expect(nativeChatAttachmentLandingTargetFor(owner, pairedTarget)).toBe(pairedTarget)
  })

  it('keeps a paired chat off another server’s workspace', () => {
    const owner: NativeChatAttachmentOwner = {
      kind: 'runtime-session',
      environmentId: 'env-2',
      pairingRevision: 1,
      sessionId: 'session-1'
    }

    expect(nativeChatAttachmentLandingTargetFor(owner, pairedTarget)).toBeNull()
  })

  it('has no landing place for a chat this client cannot reach', () => {
    expect(nativeChatAttachmentLandingTargetFor({ kind: 'remote' }, localTarget)).toBeNull()
    expect(nativeChatAttachmentLandingTargetFor({ kind: 'not-ready' }, localTarget)).toBeNull()
  })

  it('has no landing place without a workspace', () => {
    expect(nativeChatAttachmentLandingTargetFor({ kind: 'local' }, null)).toBeNull()
  })
})
