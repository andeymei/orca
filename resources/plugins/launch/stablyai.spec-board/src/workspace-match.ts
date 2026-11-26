// Matches a project to the workspace that holds it. The path in the registry is written by
// hand, so it may carry Windows separators, a trailing slash or a different case; the row Orca
// reports is the truth, and the match has to find it.
//
// The match never falls back to another workspace. A command run in the wrong directory is worse
// than no command at all, so a path that does not match exactly — after normalization — matches
// nothing, and the worker says so.

import type { ProjectRef } from './model'

/** One workspace as Orca reports it. */
export type WorkspaceRow = {
  id: string
  path: string
  hostId: string | null
  /** The project the workspace belongs to, when Orca knows one. */
  projectId?: string | null
  /** The project's name, when Orca knows one. */
  project?: string | null
}

/** One workspace with the fields the registry needs. */
export type WorkspaceListRow = WorkspaceRow

/**
 * One path as one string: forward slashes, no repeated or trailing slash. The case is kept: two
 * workspaces on one host whose paths differ only in case are two directories on a
 * case-sensitive filesystem, and the command has to run in the one that was named.
 */
function normalizeSeparators(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '')
}

/**
 * One path as one string: forward slashes, no repeated or trailing slash, lower case. The case
 * is folded for the fallback comparison — a registry path typed by hand in another case still
 * finds its row — while the exact comparison is tried first.
 */
export function normalizePath(path: string): string {
  return normalizeSeparators(path).toLowerCase()
}

/**
 * Whether a row belongs to the host a project lives on. A row without a host is one on this
 * machine — a project-group folder Orca cannot tie to a host — so it belongs to a local project.
 */
function sameHost(rowHostId: string | null, projectHost: string): boolean {
  if (rowHostId === null) {
    return projectHost === 'local'
  }
  return rowHostId === projectHost
}

/**
 * The workspace that holds the project, or null when none does. The host has to match too: the
 * same path on two hosts is two different directories.
 *
 * The exact path wins over the case-folded one. Two workspaces on one host whose paths differ
 * only in case are two directories on a case-sensitive filesystem, and a command run in the
 * wrong one is the outcome this plugin must never produce. The folded comparison is the
 * fallback: a registry path written by hand in another case still finds its row.
 */
export function findWorkspaceId(
  rows: readonly WorkspaceRow[],
  project: { path: string; host: string }
): string | null {
  const exact = normalizeSeparators(project.path)
  for (const row of rows) {
    if (!sameHost(row.hostId, project.host)) {
      continue
    }
    if (normalizeSeparators(row.path) === exact) {
      return row.id
    }
  }
  const folded = normalizePath(project.path)
  for (const row of rows) {
    if (!sameHost(row.hostId, project.host)) {
      continue
    }
    if (normalizePath(row.path) === folded) {
      return row.id
    }
  }
  return null
}

/**
 * Whether a row is a workspace on this machine. A row without a host is one on this machine: it
 * is a project-group folder Orca cannot tie to a host.
 */
export function isLocalWorkspace(row: WorkspaceRow): boolean {
  return row.hostId === null || row.hostId === 'local'
}

/**
 * The name a path carries: its last segment. Both separators count, because a path may be a
 * Windows one even when it is read on another machine.
 */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part !== '')
  return parts.at(-1) ?? path
}

/**
 * The projects the workspaces stand for. Every host is kept — a project on another machine is a
 * project of the board, and dropping it is what made the remote ones invisible — and the
 * worktrees of one project are collapsed into the shortest path of that project, which is the
 * main checkout: otherwise every agent worktree of a repository would be a project of its own on
 * the board.
 */
export function projectRefsFromWorkspaces(rows: readonly WorkspaceListRow[]): ProjectRef[] {
  const byProject = new Map<string, { path: string; name: string; host: string }>()
  for (const row of rows) {
    const host = row.hostId ?? 'local'
    // Two hosts may hold a project of the same id; the host is part of the key.
    const key = `${host}|${row.projectId ?? row.path}`
    const existing = byProject.get(key)
    if (existing === undefined || row.path.length < existing.path.length) {
      byProject.set(key, { path: row.path, name: row.project ?? baseName(row.path), host })
    }
  }
  return [...byProject.values()].map((entry) => ({
    name: entry.name,
    host: entry.host,
    path: entry.path
  }))
}
