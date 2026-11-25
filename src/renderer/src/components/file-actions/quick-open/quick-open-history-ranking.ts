import {
  getPreparedQuickOpenFiles,
  rankQuickOpenFiles,
  QUICK_OPEN_RESULT_LIMIT
} from '../../../../../shared/quick-open/quick-open-path-search'
import { searchFileRank } from '../../../../../shared/file-search/search-file-classification'

// One listing serves every keystroke; rebuilding its membership set per query scanned it all again.
const availablePaths = new WeakMap<readonly string[], ReadonlySet<string>>()

export function rankQuickOpenFilesWithHistory(
  query: string,
  files: readonly string[],
  history: readonly string[]
): { path: string; score: number }[] {
  let available = availablePaths.get(files)
  if (!available) {
    available = new Set(files)
    availablePaths.set(files, available)
  }
  const eligibleHistory = history.filter((path) => available.has(path))
  const recent = rankQuickOpenFiles(
    query,
    getPreparedQuickOpenFiles(eligibleHistory),
    eligibleHistory.length
  )
  const recency = new Map(eligibleHistory.map((path, index) => [path, index]))
  // Recency orders history, but authored files still lead so a stale build artifact does not open first.
  recent.sort(
    (a, b) =>
      searchFileRank(a.path) - searchFileRank(b.path) ||
      (recency.get(a.path) ?? 0) - (recency.get(b.path) ?? 0)
  )
  const recentPaths = new Set(recent.map((item) => item.path))
  return [
    ...recent,
    ...rankQuickOpenFiles(query, getPreparedQuickOpenFiles(files)).filter(
      (item) => !recentPaths.has(item.path)
    )
  ].slice(0, QUICK_OPEN_RESULT_LIMIT)
}
