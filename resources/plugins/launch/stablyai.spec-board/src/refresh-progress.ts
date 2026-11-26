// What the agent says about the refresh it is doing: how many projects it has scanned, how many
// there are, and which one it is on.
//
// The agent writes this after every project, so the panel can draw a bar that moves. A file that
// is not there, or that does not have the shape, means "no number to show" — never a failed
// refresh: the snapshot is what the board reads, and this file only says how far the agent has come.
//
// Why this module reads no file: the panel draws the bar, and the panel runs in a frame that has
// no file system — a module of its own that reached for one would fail to load at all, and the
// panel with it. The reading lives in `refresh-progress-file.ts`, which only the worker uses.

import { isRecord } from './unknown-values'

/** How far the refresh has come. */
export type RefreshProgress = {
  /** How many projects the agent has scanned. */
  done: number
  /** How many projects there are to scan. */
  total: number
  /** The project it is on now; empty when it is between two of them. */
  current: string
}

/**
 * The progress in a raw JSON value, or null when the value is not one.
 *
 * The counts have to hold: more scanned than there are, or a total of none, would make the bar
 * claim something the agent never said. A progress that does not hold is no progress — the panel
 * draws a bar that does not claim to know.
 */
export function parseRefreshProgress(raw: unknown): RefreshProgress | null {
  if (!isRecord(raw)) {
    return null
  }
  const done = raw['done']
  const total = raw['total']
  const current = raw['current']
  if (typeof done !== 'number' || typeof total !== 'number') {
    return null
  }
  if (!Number.isInteger(done) || !Number.isInteger(total)) {
    return null
  }
  if (done < 0 || total <= 0 || done > total) {
    return null
  }
  if (typeof current !== 'string') {
    return null
  }
  return { done, total, current }
}

/** How far along the percent a progress bar takes. */
export function progressPercent(progress: RefreshProgress): number {
  return Math.min(100, Math.max(0, Math.round((progress.done / progress.total) * 100)))
}

/**
 * What the scan list tells the agent about the progress file.
 *
 * It is in the list and not in the prompt: the prompt has room for the task and the rules, and
 * nothing else — `agent.launch` refuses a prompt of more than 4096 characters. The agent reads
 * the list anyway, so the shape of the progress file belongs beside the shape of the snapshot.
 */
export function progressInstructions(path: string): Record<string, unknown> {
  return {
    path,
    afterEachProject: '每扫完一个项目就写一次',
    fields: {
      done: '已扫完的项目数（整数）',
      total: '这次要扫的项目总数（整数）',
      current: '正在扫的项目名（字符串）'
    },
    how: `先写 ${path}.tmp，写完再 rename 成正式文件，这样读的人永远看不到写了一半的文件`
  }
}
