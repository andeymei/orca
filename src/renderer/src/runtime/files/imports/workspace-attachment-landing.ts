import { joinPath } from '@/lib/path'
import { importExternalPathsToRuntime } from '@/runtime/files/imports/runtime-file-import-client'
import type { RuntimeFileOperationArgs } from '@/runtime/files/runtime-file-client-types'
import { runtimeTargetForOwnerEnvironment } from '@/runtime/rpc/targets/runtime-client-target'
import {
  DROP_STAGING_GITIGNORE_CONTENT,
  DROP_STAGING_RELATIVE_DIR
} from '../../../../../shared/file-import/drop-staging-ignore'
import { isTerminalDropWindowsPathLike } from '../../../../../shared/terminal/input/image-path-paste'

export type WorkspaceAttachmentLandingRequest = {
  /** Local absolute paths of the picked, pasted or dropped files. */
  sourcePaths: readonly string[]
  /** The workspace root that owns them. */
  workspacePath: string
  worktreeId: string
  /** The runtime environment that owns the workspace, when it is a paired runtime. */
  runtimeEnvironmentId?: string | null
  /** The SSH target that owns the workspace, when it is a direct SSH host. */
  connectionId?: string | null
  /** The host the copy must land on; a runtime host owns its own file path. */
  expectedExecutionHostId?: 'local' | `ssh:${string}`
  expectedSshTargetId?: string
  expectedSshConnectionGeneration?: number
  /**
   * Throws when the host changed under the copy; the caller turns it into a retry notice.
   * The runtime branch enforces it; the local branch ignores it, so the caller must re-check.
   */
  assertCurrent?: () => void
}

export type WorkspaceAttachmentLandingResult = {
  copied: { sourcePath: string; workspacePath: string }[]
  skipped: { sourcePath: string; reason: string }[]
  failed: { sourcePath: string; reason: string }[]
}

/** Where attachments land inside the workspace that owns them. */
export function workspaceAttachmentDropDir(workspacePath: string): string {
  const dropDir = joinPath(workspacePath, DROP_STAGING_RELATIVE_DIR)
  return isTerminalDropWindowsPathLike(workspacePath) ? dropDir.replace(/\//g, '\\') : dropDir
}

/** Copies the sources into the workspace that owns them and reports what landed there. */
export async function landWorkspaceAttachments(
  request: WorkspaceAttachmentLandingRequest
): Promise<WorkspaceAttachmentLandingResult> {
  // An empty drop must not cost a staging round trip on a runtime host.
  if (request.sourcePaths.length === 0) {
    return { copied: [], skipped: [], failed: [] }
  }
  const destDir = workspaceAttachmentDropDir(request.workspacePath)
  // The copy target and the ignore file must agree on the host, so normalize the owner once.
  const runtimeEnvironmentId = request.runtimeEnvironmentId?.trim() || null
  const context: RuntimeFileOperationArgs = {
    target: runtimeTargetForOwnerEnvironment(runtimeEnvironmentId),
    worktreeId: request.worktreeId,
    worktreePath: request.workspacePath,
    expectedExecutionHostId: request.expectedExecutionHostId,
    expectedSshTargetId: request.expectedSshTargetId,
    expectedSshConnectionGeneration: request.expectedSshConnectionGeneration,
    connectionId: request.connectionId ?? undefined
  }
  // The importer copies locally unless a runtime environment owns the worktree; the ignore file follows the copy.
  const copiesLocally =
    context.target.kind !== 'environment' || !context.worktreeId || !context.worktreePath
  const { results } = await importExternalPathsToRuntime(
    context,
    [...request.sourcePaths],
    destDir,
    {
      ensureDestinationDir: true,
      assertCurrent: request.assertCurrent,
      nameExtensionlessImages: true
    }
  )

  const copied: WorkspaceAttachmentLandingResult['copied'] = []
  const skipped: WorkspaceAttachmentLandingResult['skipped'] = []
  const failed: WorkspaceAttachmentLandingResult['failed'] = []
  for (const result of results) {
    if (result.status === 'imported') {
      copied.push({ sourcePath: result.sourcePath, workspacePath: result.destPath })
    } else if (result.status === 'skipped') {
      skipped.push({ sourcePath: result.sourcePath, reason: result.reason })
    } else {
      failed.push({ sourcePath: result.sourcePath, reason: result.reason })
    }
  }

  if (copied.length > 0 && copiesLocally) {
    await ignoreDropStaging(destDir)
  }
  return { copied, skipped, failed }
}

// A runtime copy ignores its own staging directory; a local one has to be told to.
async function ignoreDropStaging(destDir: string): Promise<void> {
  try {
    await window.api.fs.writeFile({
      filePath: joinPath(destDir, '.gitignore'),
      content: DROP_STAGING_GITIGNORE_CONTENT
    })
  } catch {
    // An unwritable ignore file leaves the attachments themselves usable.
  }
}
