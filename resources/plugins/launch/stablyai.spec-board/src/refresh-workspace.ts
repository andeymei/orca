// The workspace a refresh runs in.
//
// It runs on this machine, always: the snapshot it writes has to be where the worker reads it
// from, and a snapshot written on another host is a file nobody ever opens. The agent reaches the
// other hosts over ssh, so a remote project is still collected — it is only the agent that runs
// here.
//
// The workspace is the one the person named, else the focused one, else any local workspace.

import { requestError } from './request-error'
import type { Settings } from './board-projects'
import { isLocalWorkspace, type WorkspaceRow } from './workspace-match'

/** The workspace the refresh would run in, or null when this machine has none. */
export function refreshWorkspaceId(
  settings: Settings,
  workspaces: readonly WorkspaceRow[],
  focusedId: string | null
): string | null {
  if (settings.refreshWorkspace !== '') {
    return settings.refreshWorkspace
  }
  const focused = focusedId === null ? undefined : workspaces.find((row) => row.id === focusedId)
  if (focused !== undefined && (focused.hostId === null || focused.hostId === 'local')) {
    return focused.id
  }
  return workspaces.find((row) => row.hostId === null || row.hostId === 'local')?.id ?? null
}

/**
 * The workspace a refresh runs in, and the check that it is on this machine.
 *
 * A refresh that would run on another machine is refused: the snapshot it writes would live
 * there, where this worker never reads it.
 */
export function refreshWorkspace(
  settings: Settings,
  workspaces: readonly WorkspaceRow[],
  focusedId: string | null
): string {
  const workspaceId = refreshWorkspaceId(settings, workspaces, focusedId)
  if (workspaceId === null) {
    throw requestError('invalid_params', '本机没有可用的 workspace 来刷新')
  }
  const named = workspaces.find((row) => row.id === workspaceId)
  if (named !== undefined && !isLocalWorkspace(named)) {
    throw requestError(
      'invalid_params',
      '刷新必须在本机运行：快照只有写在本机，看板才读得到它。请把「刷新在哪个 workspace 运行」指向本机的 workspace。'
    )
  }
  return workspaceId
}
