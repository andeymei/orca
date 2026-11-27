// Puts one project's facts into the snapshot the board reads.
//
// The snapshot is one file that holds every project, so a refresh of one project that rewrote it
// would cost the board the projects nobody re-read. The facts of one project are therefore merged
// in, and everything else is left exactly as it was.
//
// Nothing here reads or writes a file: the merge is a function of what it is given, so the rule
// that decides which facts win can be read, and tested, on its own.

import type { BoardSnapshot, SnapshotItem, SnapshotProject } from './model'

/** One project's facts, and the work items that belong to it. */
export type ProjectFacts = {
  project: SnapshotProject
  items: readonly SnapshotItem[]
}

/** The facts a snapshot holds about one project, or null when it holds none. */
export function factsOf(snapshot: BoardSnapshot, projectId: string): ProjectFacts | null {
  const project = snapshot.projects.find((entry) => entry.id === projectId)
  if (project === undefined) {
    return null
  }
  return { project, items: snapshot.items.filter((item) => item.projectId === projectId) }
}

/**
 * The snapshot with this project's entry and its work items replaced.
 *
 * The CLI answer is the one field a local scan does not have: a scan says what the project
 * holds, not whether the OpenSpec CLI is installed there. The answer the snapshot already holds
 * stays until a probe says otherwise — a refresh of one project must not make the board forget
 * what it already knew.
 *
 * The project and its items are sorted by their ids, so the same facts always give the same
 * file: two refreshes of the same project leave the snapshot in the same shape.
 */
export function applyProjectFacts(snapshot: BoardSnapshot, facts: ProjectFacts): BoardSnapshot {
  const existing = snapshot.projects.find((entry) => entry.id === facts.project.id)
  const project: SnapshotProject = {
    ...facts.project,
    openspecCli: facts.project.openspecCli ?? existing?.openspecCli ?? null
  }
  return {
    ...snapshot,
    generatedAt: new Date().toISOString(),
    projects: [
      ...snapshot.projects.filter((entry) => entry.id !== project.id),
      project
    ].sort(byId),
    items: [
      ...snapshot.items.filter((item) => item.projectId !== project.id),
      ...facts.items
    ].sort(byItemId)
  }
}

/** The two facts in the order the snapshot keeps them. */
function byId(left: SnapshotProject, right: SnapshotProject): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

/** The two work items in the order the snapshot keeps them. */
function byItemId(left: SnapshotItem, right: SnapshotItem): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

/**
 * The time a project was scanned, or null when the time cannot be read.
 *
 * A time without a zone is read as UTC: the snapshot is written by an agent, on a machine whose
 * zone is not the reader's.
 */
export function scannedAtOf(project: SnapshotProject): number | null {
  const value = project.scannedAt
  if (value === '') {
    return null
  }
  const hasZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  const at = Date.parse(hasZone ? value : `${value}Z`)
  return Number.isNaN(at) ? null : at
}

/**
 * Whether what was collected at `collectedAt` is newer than what the board holds.
 *
 * The two times are the times the facts were collected, not the times the files were written:
 * the plugin writes the board's snapshot itself whenever it merges something into it, so the
 * file's time says when the file was touched, not when the facts were gathered. A time nobody
 * can read is no evidence, so the new facts win.
 */
export function supersedes(collectedAt: number | null, boardAt: number | null): boolean {
  if (collectedAt === null || boardAt === null) {
    return true
  }
  return collectedAt >= boardAt
}
