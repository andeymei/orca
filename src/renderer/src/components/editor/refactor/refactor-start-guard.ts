/**
 * The guard that keeps one file from starting two refactorings.
 *
 * Why it lives outside the button: the trigger only renders on an edit file, so leaving the file
 * unmounts it while the propose request is still in flight, and a remount must still refuse.
 */
const startingFiles = new Set<string>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

/** The identity of a file's refactoring start: the workspace it runs in and the file it runs on. */
export function refactorStartKey(worktreeId: string, relativePath: string): string {
  return `${worktreeId}::${relativePath}`
}

/** Whether a refactoring of this file is still starting. */
export function isRefactorStarting(worktreeId: string, relativePath: string): boolean {
  return startingFiles.has(refactorStartKey(worktreeId, relativePath))
}

/** Watches the starts; the callback runs whenever one begins or ends. */
export function subscribeRefactorStarts(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Claims the start of a refactoring.
 *
 * Why it refuses: a second start would run a second agent turn on the same file, and the user
 * would pay for two reviews of one change.
 */
export function beginRefactorStart(worktreeId: string, relativePath: string): boolean {
  const key = refactorStartKey(worktreeId, relativePath)
  if (startingFiles.has(key)) {
    return false
  }
  startingFiles.add(key)
  notify()
  return true
}

/** Releases the start; the request settled, one way or the other. */
export function endRefactorStart(worktreeId: string, relativePath: string): void {
  if (!startingFiles.delete(refactorStartKey(worktreeId, relativePath))) {
    return
  }
  notify()
}
