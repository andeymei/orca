import { readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { refactorJobRegistry } from './refactor-job-registry'

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

/** Removes the scratch directories that expired, and the jobs that own them. */
export async function removeExpiredRefactorJobs(
  scratchParentRoot: string,
  currentJobId: string
): Promise<void> {
  try {
    const removed = await cleanExpiredRefactorScratch({
      scratchParentRoot,
      excludeJobId: currentJobId
    })
    for (const jobId of removed) {
      // The directory is named after the job, and only a discard used to retire a job.
      refactorJobRegistry.remove(jobId)
    }
  } catch {
    // A cleanup failure leaves old directories behind; it must not stop the new request.
  }
}

/**
 * Removes the scratch tree of a job that is gone.
 *
 * The agent's death is asynchronous, so a write after the discard recreates the tree; the run
 * that owns the tree removes it again once it ends, instead of leaving an orphan directory.
 */
export async function removeDiscardedRefactorScratch(
  jobId: string,
  scratchRoot: string
): Promise<void> {
  if (refactorJobRegistry.get(jobId) !== null) {
    return
  }
  try {
    await rm(scratchRoot, { recursive: true, force: true })
  } catch {
    // The directory stays until the next sweep finds it.
  }
}
