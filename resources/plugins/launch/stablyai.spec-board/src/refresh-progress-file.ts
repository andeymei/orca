// The refresh's progress, read from the file the agent writes.
//
// The reading lives here and not in `refresh-progress.ts`: the panel draws the bar, and the panel
// runs in a frame with no file system — a module of its own that reached for one would fail to
// load at all, and the panel with it. Only the worker reads the file.

import { readFile } from 'node:fs/promises'
import { parseRefreshProgress, type RefreshProgress } from './refresh-progress'
import { progressPath } from './store-paths'

/** The progress on disk, or null when there is none to show. */
export async function readRefreshProgress(): Promise<RefreshProgress | null> {
  let raw: string
  try {
    raw = await readFile(progressPath(), 'utf8')
  } catch {
    return null
  }
  try {
    return parseRefreshProgress(JSON.parse(raw))
  } catch {
    return null
  }
}
