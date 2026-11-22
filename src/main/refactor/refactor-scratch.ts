import path from 'node:path'

/**
 * The directory of the baseline copy of the file under review.
 *
 * It sits beside the proposal directories and is not one of them, so the plan skips it.
 */
export const REFACTOR_SOURCE_DIRECTORY_NAME = '_source'

/**
 * The scratch tree's relative spelling: the prompt hands the agent this path and the agent
 * resolves it against the workspace root.
 */
export function refactorScratchRelativeRoot(jobId: string): string {
  return path.join('.orca', 'refactor', jobId)
}

/**
 * The same directory as an absolute path: the write gate and the manifest read need one, and a
 * relative path would resolve against whatever the agent's cwd happens to be.
 */
export function refactorScratchRoot(workspaceRoot: string, jobId: string): string {
  return path.join(workspaceRoot, refactorScratchRelativeRoot(jobId))
}

/** The directory every job of one workspace lives in; the cleanup walks it. */
export function refactorScratchParentRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.orca', 'refactor')
}
