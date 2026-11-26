// Which workspace an action runs in.
//
// A local project runs in the workspace that holds it: the command is built from the project's
// own artifacts and has to run in its directory.
//
// A remote project runs in a workspace of this machine. This desktop cannot dispatch a terminal
// or an agent into another machine — the PTY registry only knows `local` — and an agent that
// runs here reaches that machine over ssh, the same way the refresh reads a remote project's
// artifacts.

import type { Board } from './board-load'
import type { Settings } from './board-projects'
import type { SnapshotProject } from './model'
import { findWorkspaceId, isLocalWorkspace } from './workspace-match'

/** The workspace an action of this project runs in, or null when there is none. */
export function actionWorkspaceId(
  board: Board,
  project: SnapshotProject,
  settings: Settings
): string | null {
  if (project.host === 'local') {
    return findWorkspaceId(board.workspaces, { path: project.path, host: project.host })
  }
  return localWorkspaceId(board, settings)
}

/**
 * A workspace on this machine: the one the setting names, else the focused one, else any.
 */
export function localWorkspaceId(board: Board, settings: Settings): string | null {
  const named = board.workspaces.find((row) => row.id === settings.refreshWorkspace)
  if (named !== undefined && isLocalWorkspace(named)) {
    return named.id
  }
  const focused = board.payload.focus
  if (focused !== null) {
    const row = board.workspaces.find((entry) => entry.id === focused.workspaceId)
    if (row !== undefined && isLocalWorkspace(row)) {
      return row.id
    }
  }
  return board.workspaces.find(isLocalWorkspace)?.id ?? null
}
