import { captureDirectSshMutationExpectation } from '@/runtime/hosts/ssh/ssh-mutation-expectation'
import { chatWorkspaceByTabId as findTerminalTabWorktreeId } from '../../../../lib/agent-session/tab-identity/structured-chat-tab-index'
import { getConnectionIdFromState } from '../../../../lib/workspace/ownership/connection-owner-resolution'
import { runtimeEnvironmentIdForWorkspaceOwner } from '../../../../lib/workspace/ownership/resolve-owner'
import { resolveWorktreePathOnOwnerHost } from '../../../../lib/workspace/ownership/worktree-path-on-owner-host'
import {
  LOCAL_EXECUTION_HOST_ID,
  toRuntimeExecutionHostId,
  toSshExecutionHostId
} from '../../../../../../shared/execution-host'
import type { AppState } from '../../../../store/types'
import type { NativeChatAttachmentOwner } from './native-chat-attachment-owner'

/** Where the composer's attachments land: the workspace that owns the chat, on the host that owns it. */
export type NativeChatAttachmentLandingTarget = {
  worktreeId: string
  workspacePath: string
  /** The paired runtime that owns the workspace; null when this machine owns it. */
  runtimeEnvironmentId: string | null
  /** The SSH target that owns the workspace; null when no direct SSH host does. */
  connectionId: string | null
  expectedExecutionHostId: 'local' | `ssh:${string}`
  expectedSshTargetId?: string
  expectedSshConnectionGeneration?: number
}

/**
 * The workspace a chat's attachments can land in, or null when the chat has no workspace
 * or the host that owns it cannot be named.
 */
export function resolveNativeChatAttachmentLandingTarget(
  state: AppState,
  workspace: { structuredWorktreeId?: string; terminalTabId: string }
): NativeChatAttachmentLandingTarget | null {
  const worktreeId =
    workspace.structuredWorktreeId ??
    findTerminalTabWorktreeId(state.tabsByWorktree, workspace.terminalTabId)
  if (!worktreeId) {
    return null
  }
  const environmentOwner = runtimeEnvironmentIdForWorkspaceOwner(state, { workspaceId: worktreeId })
  if (environmentOwner.kind === 'ambiguous') {
    return null
  }
  const runtimeEnvironmentId = environmentOwner.environmentId
  const connectionId = getConnectionIdFromState(state, worktreeId) ?? null
  const hostId = runtimeEnvironmentId
    ? toRuntimeExecutionHostId(runtimeEnvironmentId)
    : connectionId
      ? toSshExecutionHostId(connectionId)
      : LOCAL_EXECUTION_HOST_ID
  const workspacePath = resolveWorktreePathOnOwnerHost(
    worktreeId,
    undefined,
    hostId,
    runtimeEnvironmentId
  )
  if (!workspacePath) {
    return null
  }
  // An SSH host that cannot name its generation would refuse the copy later; refuse it here instead.
  let expectation: {
    expectedExecutionHostId: 'local' | `ssh:${string}`
    expectedSshTargetId?: string
    expectedSshConnectionGeneration?: number
  }
  try {
    expectation = connectionId
      ? captureDirectSshMutationExpectation(state, connectionId, runtimeEnvironmentId)
      : { expectedExecutionHostId: 'local' }
  } catch {
    return null
  }
  return {
    worktreeId,
    workspacePath,
    runtimeEnvironmentId,
    connectionId,
    ...expectation
  }
}

/**
 * A file lands where the agent that reads it runs: this machine for a local chat, the paired
 * server for a chat on one. A chat whose workspace lives elsewhere keeps its current route.
 */
export function nativeChatAttachmentLandingTargetFor(
  owner: NativeChatAttachmentOwner,
  target: NativeChatAttachmentLandingTarget | null
): NativeChatAttachmentLandingTarget | null {
  if (!target) {
    return null
  }
  if (owner.kind === 'local') {
    return target.runtimeEnvironmentId === null ? target : null
  }
  if (owner.kind === 'runtime-session') {
    return target.runtimeEnvironmentId === owner.environmentId ? target : null
  }
  return null
}

/** The workspace moved under the intake; the captured copy would land somewhere else. */
export function nativeChatAttachmentLandingTargetUnchanged(
  captured: NativeChatAttachmentLandingTarget,
  current: NativeChatAttachmentLandingTarget | null
): boolean {
  return (
    current !== null &&
    captured.worktreeId === current.worktreeId &&
    captured.workspacePath === current.workspacePath &&
    captured.runtimeEnvironmentId === current.runtimeEnvironmentId
  )
}

/** The workspace a chat's attachments land in, when its agent runs on the host that owns it. */
export function resolveNativeChatLandingTargetForOwner(
  state: AppState,
  owner: NativeChatAttachmentOwner,
  workspace: { structuredWorktreeId?: string; terminalTabId: string }
): NativeChatAttachmentLandingTarget | null {
  return nativeChatAttachmentLandingTargetFor(
    owner,
    resolveNativeChatAttachmentLandingTarget(state, workspace)
  )
}
