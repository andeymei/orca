import path from 'node:path'
import {
  pathRulesNotRelativeMessage,
  pathRulesOutsideWorkspaceMessage,
  pathRulesUnsafeSegmentMessage
} from './refactor-messages'
import { isSafeMobileRelativePath } from '../runtime/files/mobile-file-kind'
import {
  hasUnsafePathSegment,
  isPathInsideWorkspace,
  isWindowsDriveRelativePath
} from './refactor-write-gate'

/**
 * The path rule of the feature: no absolute path, no `..` segment, and no trailing dot or space
 * that Windows strips before it reads `..`.
 */
export function isSafeRelativeRefactorPath(relativePath: string): boolean {
  return isSafeMobileRelativePath(relativePath) && !hasUnsafePathSegment(relativePath)
}

/**
 * The key a file path is claimed under: the separators are normalised and the case folded, because
 * macOS and Windows read `src\foo.ts` and `src/foo.ts` as one file, and a missed conflict silently
 * overwrites the first proposal's file.
 *
 * The case folding belongs here and only here: a false collision costs the user a proposal,
 * which is a cheap mistake.
 */
export function refactorPathKey(filePath: string): string {
  return filePath.split(/[\\/]/).join('/').toLowerCase()
}

/**
 * The path the agent may read and the plan may name.
 *
 * The path rule rejects absolute paths, `..` segments and the trailing dot or space Windows
 * strips before it reads `..`; the drive-relative rule rejects a path that resolves onto another
 * drive. The containment check is defence in depth: no path that survives the rules above
 * resolves outside the workspace today, and it is the layer that catches a future change in them.
 * It compares physical locations, so a directory inside the workspace that is a link out of it is
 * refused as well.
 */
export async function assertSafeRefactorTargetPath(
  workspaceRoot: string,
  relativePath: string
): Promise<void> {
  if (!isSafeRelativeRefactorPath(relativePath)) {
    throw new Error(
      hasUnsafePathSegment(relativePath)
        ? pathRulesUnsafeSegmentMessage()
        : pathRulesNotRelativeMessage()
    )
  }
  const resolvesOutside =
    isWindowsDriveRelativePath(relativePath) ||
    !(await isPathInsideWorkspace(workspaceRoot, path.resolve(workspaceRoot, relativePath)))
  if (resolvesOutside) {
    throw new Error(pathRulesOutsideWorkspaceMessage())
  }
}
