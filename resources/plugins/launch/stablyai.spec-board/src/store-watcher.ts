// The watcher on the plugin's own directory.
//
// The directory holds everything the board reads: the snapshot, the progress the agent reports,
// and the file a refresh of one project writes. The watcher is what tells the open panels that
// something there has changed.
//
// The system does not always say what changed. A batch of changes is reported as the directory's
// own change, and the name that comes with it is the directory's — a file that was written plainly
// is never named. Sometimes nothing is reported at all. So the event is the fast way and not the
// only one: the files the board reads are polled as well, and the poll does not keep the worker
// alive.
//
// The board's facts do not wait for any of this: the board is merged and read again on every
// read, so a lost event costs the board nothing but a moment.

import { watch, watchFile, type FSWatcher } from 'node:fs'
import type { OrcaWorkerApi } from 'orca/worker'
import { snapshotAt, type BoardState } from './board-load'
import { mergeFragmentsIn } from './project-refresh'
import { readRefreshProgress } from './refresh-progress-file'
import { boardStoreDir, progressPath, snapshotPath } from './store-paths'

/** How often the files the board reads are polled, in milliseconds. */
const POLL_INTERVAL_MS = 500

/** The watcher on the store directory, and the polls that stand behind it. */
export type StoreWatcher = { close: () => void }

/**
 * Watches the store directory, so a new snapshot reaches the open panels — and so the agent's
 * progress does too.
 *
 * What the watcher has already said is its own: two watchers on two boards each have their own
 * panels, and one board's snapshot says nothing about the other's.
 */
export function startWatcher(orca: OrcaWorkerApi, state: BoardState): StoreWatcher {
  const dir = boardStoreDir()
  // When the board's snapshot was last announced: its own time says whether there is anything
  // new to say, and a snapshot that has not moved is not announced twice.
  let announcedSnapshotAt: number | null = null
  // The progress the panels were last told about: the agent writes it after every project it
  // scans, and the panels draw the bar again when they are told.
  let announcedProgress: string | null = null
  let closed = false

  /** Tells the panels what the store directory holds, if any of it is new. */
  const announce = (): void => {
    if (closed) {
      return
    }
    void mergeFragmentsIn(dir, orca, state)
    void announceSnapshot()
    void announceProgress()
  }

  let watcher: FSWatcher | null = null
  try {
    watcher = watch(dir, announce)
    // The watch must not keep the process alive: the worker's own lifetime decides that.
    watcher.unref()
  } catch (error) {
    orca.log(`[spec-board] 无法监听 ${dir}：${messageOf(error)}`)
  }
  // The sure way: the two files the board reads are polled, because the system does not always
  // deliver an event. The poll does not keep the worker alive either — an idle worker is still
  // reaped.
  const snapshotPoll = watchFile(snapshotPath(), { interval: POLL_INTERVAL_MS, persistent: false }, announce)
  const progressPoll = watchFile(progressPath(), { interval: POLL_INTERVAL_MS, persistent: false }, announce)

  return {
    close: () => {
      closed = true
      watcher?.close()
      snapshotPoll.unref()
      progressPoll.unref()
    }
  }

  /**
   * Tells the panels that the board's snapshot moved.
   *
   * The snapshot's own time says whether there is anything new to say: a snapshot that has not
   * moved is not announced twice.
   */
  async function announceSnapshot(): Promise<void> {
    const at = await snapshotAt()
    if (at === null || at === announcedSnapshotAt) {
      return
    }
    announcedSnapshotAt = at
    orca.panels.post('board.changed', { agentAt: at })
  }

  /**
   * Tells the panels how far the refresh has come.
   *
   * The progress is a file the agent writes after every project it scans, and the event does not
   * always name it. So the file is read instead — and it is said only when it says something new,
   * because the panels draw the bar again when they are told.
   */
  async function announceProgress(): Promise<void> {
    const progress = await readRefreshProgress()
    const said = progress === null ? null : JSON.stringify(progress)
    if (said === announcedProgress) {
      return
    }
    announcedProgress = said
    orca.panels.post('board.progress.changed', { progress })
  }
}

/** Why the watcher could not be started, in the words the log holds. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
