// Which workspace an action runs in.
//
// The project's own workspace, wherever it lives: a local project runs in the workspace here that
// holds it, and a remote project's action runs in that project's workspace on the server that
// holds it — the work belongs where the project is, and the agent belongs with it.

import type { Board } from './board-load'
import type { SnapshotProject } from './model'
import { findWorkspaceId } from './workspace-match'

/** The workspace an action of this project runs in, or null when the board holds none. */
export function actionWorkspaceId(board: Board, project: SnapshotProject): string | null {
  return findWorkspaceId(board.workspaces, { path: project.path, host: project.host })
}
