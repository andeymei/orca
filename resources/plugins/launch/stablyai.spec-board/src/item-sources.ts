// The files a piece of work was written in.
//
// A work item is two frameworks' view of one piece of work, so it owns more than one file: an
// OpenSpec change holds a proposal, a design and a task list, and the Superpowers side holds a
// design spec and a plan. The board offers every one of them, and the first is the item's main
// file — the one its title opens.
//
// Every path here is relative to the project root, which is also the workspace root: the board
// matches a project to the workspace that holds it by path, so the two are one directory.
//
// A path that came out of a repository is data, not a command. It is opened rather than run, but
// it still has to stay inside the project, so it passes the same gate every other project-derived
// value passes.

import {
  OPENSPEC_ARCHIVE_DIR,
  OPENSPEC_CHANGES_DIR,
  OPENSPEC_DESIGN_FILE,
  OPENSPEC_DIR,
  OPENSPEC_PROPOSAL_FILE,
  OPENSPEC_TASKS_FILE
} from './artifact-layout'
import { isSafeCommandPath, isSafeCommandValue } from './command-values'
import type { ItemSource, SnapshotItem } from './model'

/** The OpenSpec change's folder, relative to the project root. */
function changeFolder(changeId: string, archived: boolean): string {
  const changes = `${OPENSPEC_DIR}/${OPENSPEC_CHANGES_DIR}`
  return archived
    ? `${changes}/${OPENSPEC_ARCHIVE_DIR}/${changeId}`
    : `${changes}/${changeId}`
}

/**
 * Whether a path may be opened: relative, and made of segments that carry no shell meaning.
 *
 * The relative part matters on its own: a path that names a directory outside the project would
 * still be a safe path, and the editor would open a file the work item never mentioned.
 */
function isOpenablePath(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path)) {
    return false
  }
  return isSafeCommandPath(path)
}

/** The name of a file, as a person recognizes it. */
function fileName(path: string): string {
  return path.split('/').at(-1) ?? path
}

/**
 * The files one work item was written in, in the order the work happens: the proposal, then the
 * design — whichever framework wrote one — then the task list and the plan.
 *
 * A file that is not there is not on the list — the facts say which ones the change holds — and a
 * path that fails the gate is not on it either: the board offers no way into a file it cannot
 * vouch for.
 */
export function itemSources(item: SnapshotItem): ItemSource[] {
  const change = item.openspec
  const superpowers = item.superpowers
  const folder =
    change !== null && isSafeCommandValue(change.changeId)
      ? changeFolder(change.changeId, change.stage === 'archived')
      : null
  const proposal =
    folder !== null && change?.hasProposal === true ? `${folder}/${OPENSPEC_PROPOSAL_FILE}` : null
  const design =
    folder !== null && change?.hasDesign === true ? `${folder}/${OPENSPEC_DESIGN_FILE}` : null
  const tasks =
    folder !== null && change?.hasTasks === true ? `${folder}/${OPENSPEC_TASKS_FILE}` : null
  const spec = superpowers?.designSpec ?? null
  const plan = superpowers?.plan ?? null

  const sources: ItemSource[] = []
  if (proposal !== null) {
    sources.push({ key: 'openspec-proposal', label: OPENSPEC_PROPOSAL_FILE, path: proposal })
  }
  if (design !== null) {
    sources.push({ key: 'openspec-design', label: OPENSPEC_DESIGN_FILE, path: design })
  }
  if (spec !== null && isOpenablePath(spec)) {
    sources.push({ key: 'superpowers-spec', label: fileName(spec), path: spec })
  }
  if (tasks !== null) {
    sources.push({ key: 'openspec-tasks', label: OPENSPEC_TASKS_FILE, path: tasks })
  }
  if (plan !== null && isOpenablePath(plan)) {
    sources.push({ key: 'superpowers-plan', label: fileName(plan), path: plan })
  }
  return sources
}
