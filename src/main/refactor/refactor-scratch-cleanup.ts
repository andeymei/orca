import { readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'

/** A scratch directory older than this is nobody's business any more. */
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Removes the job directories that have not been touched for a day.
 *
 * The directory's own mtime is the clock: the agent writes into it, so a job that is still
 * running keeps its directory fresh and is never mistaken for an abandoned one.
 */
export async function cleanExpiredRefactorScratch(input: {
  scratchParentRoot: string
  excludeJobId?: string
  now?: number
  maxAgeMs?: number
}): Promise<string[]> {
  const now = input.now ?? Date.now()
  const maxAgeMs = input.maxAgeMs ?? DEFAULT_MAX_AGE_MS

  let entries
  try {
    entries = await readdir(input.scratchParentRoot, { withFileTypes: true })
  } catch {
    // No scratch directory yet is not an error; neither is an unreadable one.
    return []
  }

  const removed: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }
    if (input.excludeJobId !== undefined && entry.name === input.excludeJobId) {
      continue
    }
    const directory = path.join(input.scratchParentRoot, entry.name)
    try {
      const stats = await stat(directory)
      if (now - stats.mtimeMs <= maxAgeMs) {
        continue
      }
      await rm(directory, { recursive: true, force: true })
    } catch {
      // A directory that cannot be removed stays; it is cleaned up by the next run.
      continue
    }
    removed.push(entry.name)
  }
  return removed
}
