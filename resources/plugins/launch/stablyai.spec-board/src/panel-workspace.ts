// The fact that a project is not in an Orca workspace, and the words the panel says about it.
//
// The worker knows which workspace holds a project — the board's workspaces are the authority on
// where a project lives — and the panel only draws the consequence: the actions of that project
// are off, and they say why instead of failing after the press.

import type { SnapshotProject } from './model'

/** What a button says when the project it acts on is in no Orca workspace. */
export const NO_WORKSPACE = '该项目不在 Orca workspace 里'

/**
 * Whether the actions of a project can run: a workspace has to hold it. A project the board does
 * not know about is not held by anything either, but the board cannot say more than that, so its
 * buttons stay as they are.
 */
export function canRunActions(project: SnapshotProject | null): boolean {
  return project?.hasWorkspace !== false
}
