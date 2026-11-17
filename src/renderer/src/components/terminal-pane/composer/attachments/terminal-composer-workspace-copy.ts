import { joinPath } from '@/lib/path'
import { importExternalPathsToRuntime } from '@/runtime/files/imports/runtime-file-import-client'
import type { RuntimeFileOperationArgs } from '@/runtime/files/runtime-file-client-types'
import { runtimeTargetForOwnerEnvironment } from '@/runtime/rpc/targets/runtime-client-target'
import { DROP_STAGING_GITIGNORE_CONTENT } from '../../../../../../shared/drop-staging-ignore'
import { joinRuntimeTerminalDropDir } from '../../input/file-drop/terminal-drop-worktree-path'

export type TerminalComposerWorkspaceCopyRequest = {
  /** Local absolute paths of the picked or pasted files. */
  sourcePaths: readonly string[]
  /** The workspace root that owns the terminal. */
  workspacePath: string
  worktreeId: string
  /** The runtime environment that owns the terminal, when it is a paired runtime. */
  runtimeEnvironmentId?: string | null
  /** The SSH target that owns the terminal, when it is a direct SSH host. */
  connectionId?: string | null
  /** The host the copy must land on; a runtime host owns its own file path. */
  expectedExecutionHostId?: 'local' | `ssh:${string}`
  expectedSshTargetId?: string
  expectedSshConnectionGeneration?: number
  /** Throws when the host changed under the copy; the caller turns it into a retry notice. */
  assertCurrent?: () => void
}

export type TerminalComposerWorkspaceCopyResult = {
  copied: { sourcePath: string; workspacePath: string }[]
  skipped: { sourcePath: string; reason: string }[]
  failed: { sourcePath: string; reason: string }[]
}

/** Where a terminal's attachments land inside the workspace that owns it. */
export function terminalComposerDropDir(workspacePath: string): string {
  return joinRuntimeTerminalDropDir(workspacePath)
}

export async function copyTerminalComposerAttachmentsToWorkspace(
  request: TerminalComposerWorkspaceCopyRequest
): Promise<TerminalComposerWorkspaceCopyResult> {
  const destDir = terminalComposerDropDir(request.workspacePath)
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

  const copied: TerminalComposerWorkspaceCopyResult['copied'] = []
  const skipped: TerminalComposerWorkspaceCopyResult['skipped'] = []
  const failed: TerminalComposerWorkspaceCopyResult['failed'] = []
  for (const result of results) {
    if (result.status === 'imported') {
      copied.push({ sourcePath: result.sourcePath, workspacePath: result.destPath })
    } else if (result.status === 'skipped') {
      skipped.push({ sourcePath: result.sourcePath, reason: result.reason })
    } else {
      failed.push({ sourcePath: result.sourcePath, reason: result.reason })
    }
  }

  if (copied.length > 0 && !runtimeEnvironmentId) {
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
