/** Decide whether the gitignored-file scan still has to run after the tracked-file scan. */
import type { QuickOpenPathRanker } from '../../../../shared/quick-open/quick-open-path-search'

/**
 * The tracked scan is far cheaper than the `--no-ignore-vcs` scan, and on a real workspace it
 * already matches more paths than the result limit holds. Scanning ignored files anyway costs a
 * full-tree walk that can outlast the search timeout on a remote host, so it only runs when the
 * tracked scan left the result set short.
 */
export function shouldScanIgnoredFiles(input: {
  includeIgnored?: boolean
  primaryMatchCount: number
  limit: number
}): boolean {
  if (input.includeIgnored === false) {
    return false
  }
  return input.primaryMatchCount < input.limit
}

export type QuickOpenIgnoredPassOutcome = {
  /** The ignored scan could not finish; the tracked matches it already found stay usable. */
  failed: boolean
}

/**
 * Run the ignored-file scan only when the tracked scan left the result set short, and keep the
 * tracked matches when that scan times out on a remote host with a large tree.
 */
export async function scanIgnoredFilesWhenNeeded(input: {
  includeIgnored?: boolean
  limit: number
  ranker: QuickOpenPathRanker
  scan: () => Promise<void>
  signal?: AbortSignal
}): Promise<QuickOpenIgnoredPassOutcome> {
  const primaryMatchCount = input.ranker.result().totalCount
  if (!shouldScanIgnoredFiles({ ...input, primaryMatchCount })) {
    return { failed: false }
  }
  try {
    await input.scan()
  } catch (error) {
    if (input.signal?.aborted) {
      throw error
    }
    return { failed: true }
  }
  return { failed: false }
}
