import { userNamedFileAccess } from '@/lib/files/access/local-file-access'
import { basename } from '@/lib/path'
import type { TerminalComposerAttachment } from '@/store/slices/terminal-composer/terminal-composer'
import { AGENT_SESSION_ATTACHMENT_MAX_BYTES } from '../../../../../../shared/agent-session/agent-session-attachments'
import { isImageDropPath } from '../../../../../../shared/image-path-paste'
import { createNonSecureContextUuid } from '../../../../../../shared/non-secure-context-uuid'
import { copyTerminalComposerAttachmentsToWorkspace } from './terminal-composer-workspace-copy'

export type TerminalComposerIntakeHost = {
  /** The workspace root that owns the terminal. */
  workspacePath: string
  worktreeId: string
  /** The runtime environment that owns the terminal, when it is a paired runtime. */
  runtimeEnvironmentId?: string | null
  /** The SSH target that owns the terminal, when it is a direct SSH host. */
  connectionId?: string | null
  /** The host the copy must land on. */
  expectedExecutionHostId?: 'local' | `ssh:${string}`
  expectedSshTargetId?: string
  expectedSshConnectionGeneration?: number
  /** Throws when the host changed under the copy. */
  assertCurrent?: () => void
}

export type TerminalComposerIntakeResult = {
  attachments: TerminalComposerAttachment[]
  failed: { name: string; reason: string }[]
}

/** The attachment size the agent accepts, in the unit the limit is written in. */
const ATTACHMENT_LIMIT_MIB = AGENT_SESSION_ATTACHMENT_MAX_BYTES / (1024 * 1024)

export async function pickTerminalComposerAttachments(
  host: TerminalComposerIntakeHost
): Promise<TerminalComposerIntakeResult> {
  const paths = await window.api.shell.pickAttachments()
  if (paths.length === 0) {
    return { attachments: [], failed: [] }
  }
  return landAttachments(host, paths)
}

export async function pasteTerminalComposerAttachments(
  host: TerminalComposerIntakeHost,
  clipboardData: { files: File[]; items?: DataTransferItem[] }
): Promise<TerminalComposerIntakeResult> {
  const files = clipboardData.files
  const sourcePaths: string[] = []
  const failed: { name: string; reason: string }[] = []
  const image = files.find((file) => file.type.startsWith('image/'))
  if (image) {
    try {
      // The clipboard image is saved on this machine: the copy reads client-local sources.
      const tempPath = await window.api.ui.saveClipboardImageAsTempFile()
      // An image the clipboard could not render still carries its own local path.
      const path = tempPath ?? localPathForFile(image)
      if (path) {
        sourcePaths.push(path)
      }
    } catch (error) {
      failed.push({
        name: image.name,
        reason: error instanceof Error ? error.message : String(error)
      })
    }
  }
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      continue
    }
    const path = localPathForFile(file)
    if (path) {
      sourcePaths.push(path)
    }
  }
  // The text half of the paste is the prompt body; the editor's own paste handler owns it.
  return landAttachments(host, sourcePaths, failed)
}

export async function dropTerminalComposerAttachments(
  host: TerminalComposerIntakeHost,
  droppedPaths: readonly string[]
): Promise<TerminalComposerIntakeResult> {
  return landAttachments(host, droppedPaths)
}

/** Copy the sources into the workspace that owns the terminal and report what landed there. */
async function landAttachments(
  host: TerminalComposerIntakeHost,
  sourcePaths: readonly string[],
  failures: readonly { name: string; reason: string }[] = []
): Promise<TerminalComposerIntakeResult> {
  const failed = [...failures]
  const withinLimit: string[] = []
  for (const sourcePath of sourcePaths) {
    const byteLength = await sourceByteLength(sourcePath)
    if (byteLength !== null && byteLength > AGENT_SESSION_ATTACHMENT_MAX_BYTES) {
      failed.push({
        name: basename(sourcePath),
        reason: `'${basename(sourcePath)}' is ${byteLength} bytes, over the ${ATTACHMENT_LIMIT_MIB} MiB attachment limit`
      })
      continue
    }
    withinLimit.push(sourcePath)
  }
  if (withinLimit.length === 0) {
    return { attachments: [], failed }
  }
  const copy = await copyTerminalComposerAttachmentsToWorkspace({
    sourcePaths: withinLimit,
    workspacePath: host.workspacePath,
    worktreeId: host.worktreeId,
    runtimeEnvironmentId: host.runtimeEnvironmentId,
    connectionId: host.connectionId,
    expectedExecutionHostId: host.expectedExecutionHostId,
    expectedSshTargetId: host.expectedSshTargetId,
    expectedSshConnectionGeneration: host.expectedSshConnectionGeneration,
    assertCurrent: host.assertCurrent
  })
  const attachments = copy.copied.map((copied) => ({
    id: createNonSecureContextUuid(),
    name: basename(copied.workspacePath),
    workspacePath: copied.workspacePath,
    // The copy names an extensionless image with an image extension, so the landed path is the
    // extension it already judged; the source path covers a destination with no extension at all.
    isImage: isImageDropPath(copied.workspacePath) || isImageDropPath(copied.sourcePath)
  }))
  // A skipped source landed no better than a failed one; report it instead of dropping it.
  for (const skipped of copy.skipped) {
    failed.push({ name: basename(skipped.sourcePath), reason: skipped.reason })
  }
  for (const failure of copy.failed) {
    failed.push({ name: basename(failure.sourcePath), reason: failure.reason })
  }
  return { attachments, failed }
}

/** The size of a client-local source, or null when it cannot be read. */
async function sourceByteLength(sourcePath: string): Promise<number | null> {
  try {
    const stat = await window.api.fs.stat({ filePath: sourcePath, access: userNamedFileAccess() })
    return stat.size
  } catch {
    // An unreadable source has no known size; the copy reports why it could not land.
    return null
  }
}

/** The client-local path of a pasted file, or null when the paste carries no file behind it. */
function localPathForFile(file: File): string | null {
  const fs = window.api?.fs
  const getPathForFile = fs && 'getPathForFile' in fs ? fs.getPathForFile : undefined
  if (!getPathForFile) {
    return null
  }
  try {
    return getPathForFile(file) || null
  } catch {
    // A pasted bitmap has no file behind it.
    return null
  }
}
