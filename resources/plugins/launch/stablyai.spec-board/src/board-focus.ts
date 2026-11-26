// The project the sidebar has selected.
//
// The board follows the sidebar: the workspace Orca has focused names the project whose work the
// board shows. A focused workspace is usually a worktree, and a worktree's path is not its
// project's path — the project is the checkout the worktrees were made from. Orca's own project
// list names that checkout; without it, the shortest path among the workspaces that share a
// project id is that checkout, because the main one is the shortest.

import type { BoardFocus } from './model'
import { projectIdFor } from './project-identity'
import type { WorkspaceRow } from './workspace-match'

/** One project as Orca lists it. */
export type ProjectRow = { id: string; name: string; hostId: string; path: string }

/** The shortest of the paths, or null when there are none. */
function shortestPath(paths: readonly string[]): string | null {
  let shortest: string | null = null
  for (const path of paths) {
    if (shortest === null || path.length < shortest.length) {
      shortest = path
    }
  }
  return shortest
}

/**
 * The checkout a project lives in: the path Orca's project list gives it, or — when Orca does not
 * list that project — the shortest path among the workspaces that share its project id.
 */
function checkoutOf(
  rows: readonly WorkspaceRow[],
  projects: readonly ProjectRow[],
  row: WorkspaceRow
): { host: string; path: string } {
  const host = row.hostId ?? 'local'
  const projectId = row.projectId ?? null
  if (projectId === null) {
    // A workspace of its own — a folder Orca cannot tie to a project — is its own project.
    return { host, path: row.path }
  }
  const listed = projects.find((entry) => entry.id === projectId)
  if (listed !== undefined) {
    return { host: listed.hostId, path: listed.path }
  }
  const paths = rows
    .filter((entry) => entry.projectId === projectId && (entry.hostId ?? 'local') === host)
    .map((entry) => entry.path)
  const shortest = shortestPath(paths)
  return { host, path: shortest ?? row.path }
}

/**
 * The project the sidebar has selected, or null when nothing is selected.
 *
 * A workspace Orca does not report names nothing: the board then shows every project it knows,
 * which is what it did before the sidebar could steer it.
 */
export function focusOf(input: {
  /** The focused workspace, as Orca names it; null when none is focused. */
  workspaceId: string | null
  /** Every workspace Orca reports. */
  workspaces: readonly WorkspaceRow[]
  /** Every project Orca lists. */
  projects: readonly ProjectRow[]
}): BoardFocus | null {
  const { workspaceId, workspaces, projects } = input
  if (workspaceId === null) {
    return null
  }
  const row = workspaces.find((entry) => entry.id === workspaceId)
  if (row === undefined) {
    return null
  }
  const { host, path } = checkoutOf(workspaces, projects, row)
  return { projectId: projectIdFor(host, path), workspaceId, host, path: row.path }
}
