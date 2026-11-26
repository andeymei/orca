// The fact that a project's actions cannot run here, and the words the panel says about it.
//
// The worker knows whether the actions of a project can run — the board's workspaces are the
// authority on where a project lives — and the panel only draws the consequence: the actions of
// that project are off, and they say why instead of failing after the press.

import type { Action, SnapshotProject } from './model'

/** What a button says when a local project is in no Orca workspace. */
export const NO_WORKSPACE = '该项目不在 Orca workspace 里'

/** What a button says when this machine has no workspace to run a remote project's action. */
export const NO_LOCAL_WORKSPACE = '本机没有可用的 workspace 来跑远程项目的动作'

/**
 * Whether the actions of a project can run. A project the board does not know about is not held
 * by anything either, but the board cannot say more than that, so its buttons stay as they are.
 */
export function canRunActions(project: SnapshotProject | null): boolean {
  return project?.canRun !== false
}

/**
 * Why the actions of a project cannot run. A remote project's action is an agent that runs on
 * this machine, so it is this machine's workspaces that have to be there — not the other host's.
 */
export function noRunMessage(project: SnapshotProject | null): string {
  return project !== null && project.host !== 'local' ? NO_LOCAL_WORKSPACE : NO_WORKSPACE
}

/** Where an action runs, in the words the person reads before pressing it. */
export function runChannel(action: Action): string {
  return action.run.kind === 'terminal' ? '在终端里运行' : '交给 agent 执行'
}
