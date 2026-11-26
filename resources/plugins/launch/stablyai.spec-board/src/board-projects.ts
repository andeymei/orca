// Where the board's projects live.
//
// Orca knows the projects of this machine and of every host it reaches; the registry is the
// person's file, which adds the ones Orca does not know; `scanRoots` are the extra local roots.
// What comes out of here is the list the board shows and the list the refresh hands the agent.
//
// Everything here is a read. A host that cannot answer is a warning, not a broken board: the
// board then knows fewer projects, not no board at all.

import type { OrcaWorkerApi } from 'orca/worker'
import type { ProjectRow } from './board-focus'
import type { BoardFocus, ProjectRef } from './model'
import { projectIdFor } from './project-identity'
import { readRegistry, writeRegistryIfAbsent, type Registry } from './store-paths'
import { messageOf } from './unknown-values'
import { baseName, projectRefsFromWorkspaces, type WorkspaceRow } from './workspace-match'

/** The settings the plugin owns, as plain strings. */
export type Settings = { refreshAgent: string; refreshWorkspace: string; scanRoots: string }

/** The settings the plugin owns. A value that is not a string is not set. */
export async function readSettings(orca: OrcaWorkerApi): Promise<Settings> {
  const result = await orca.host.call('settings.get')
  const text = (key: string): string => {
    const value = result.settings[key]
    return typeof value === 'string' ? value : ''
  }
  return {
    refreshAgent: text('refreshAgent'),
    refreshWorkspace: text('refreshWorkspace'),
    scanRoots: text('scanRoots')
  }
}

/** The workspaces Orca reports; a failure is a warning, not a broken board. */
export async function listWorkspaces(
  orca: OrcaWorkerApi,
  warnings: string[]
): Promise<WorkspaceRow[]> {
  try {
    const result = await orca.host.call('workspace.list')
    return result.workspaces.map((row) => ({
      id: row.id,
      path: row.path,
      hostId: row.hostId,
      projectId: row.projectId ?? null,
      project: row.project ?? null
    }))
  } catch (error) {
    warnings.push(`无法读取 workspace 列表：${messageOf(error)}`)
    return []
  }
}

/**
 * The projects Orca lists, on every host.
 *
 * Orca's own list is the authority on which projects exist: it knows the repositories and folders
 * of this machine and of every host it reaches. An Orca too old to list them still names its
 * projects through the workspaces, so that is the fallback.
 */
export async function listProjects(
  orca: OrcaWorkerApi,
  workspaces: readonly WorkspaceRow[],
  warnings: string[]
): Promise<ProjectRow[]> {
  if (!orca.host.has('project.list')) {
    return projectRefsFromWorkspaces(workspaces).map((ref) => ({
      id: ref.path,
      name: ref.name,
      hostId: ref.host,
      path: ref.path
    }))
  }
  try {
    const result = await orca.host.call('project.list')
    return result.projects.map((row) => ({
      id: row.id,
      name: row.name,
      hostId: row.hostId ?? 'local',
      path: row.path
    }))
  } catch (error) {
    warnings.push(`无法读取项目列表：${messageOf(error)}`)
    return []
  }
}

/**
 * The workspace the sidebar has focused, or null when nothing is focused.
 *
 * A host that cannot answer is not a broken board: the board then shows every project it knows,
 * which is what it did before the sidebar could steer it.
 */
export async function focusedWorkspaceId(
  orca: OrcaWorkerApi,
  warnings: string[]
): Promise<string | null> {
  try {
    const context = await orca.host.call('workspace.readContext')
    return context?.workspaceId ?? null
  } catch (error) {
    warnings.push(`无法读取当前 workspace：${messageOf(error)}`)
    return null
  }
}

/** One project as the board names it. */
function projectRefOf(row: ProjectRow): ProjectRef {
  return { name: row.name, host: row.hostId, path: row.path }
}

/**
 * The projects the board knows: Orca's own, the registry's, and the extra scan roots.
 *
 * The registry is the person's file and may name projects Orca does not know; Orca's list knows
 * projects the registry has never heard of — the ones on another host, above all, which the
 * registry's own fallback never saw. One project is one entry, whichever list named it.
 */
export function knownProjectRefs(
  orcaProjects: readonly ProjectRow[],
  registryProjects: readonly ProjectRef[],
  scanRoots: readonly ProjectRef[]
): ProjectRef[] {
  const byId = new Map<string, ProjectRef>()
  for (const ref of [...orcaProjects.map(projectRefOf), ...registryProjects, ...scanRoots]) {
    byId.set(projectIdFor(ref.host, ref.path), ref)
  }
  return [...byId.values()].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  )
}

/**
 * The projects the worker reads from this machine.
 *
 * The registry is the list of projects to scan, and the extra roots are added to it. The focused
 * project is scanned as well: the board follows the sidebar, so the project the sidebar has
 * selected has to be on the board even when the registry never named it.
 */
export function localScanProjects(
  registryProjects: readonly ProjectRef[],
  scanRoots: readonly ProjectRef[],
  focus: BoardFocus | null
): ProjectRef[] {
  const focused: ProjectRef[] =
    focus === null || focus.host !== 'local'
      ? []
      : [{ name: baseName(focus.path), host: focus.host, path: focus.path }]
  const byId = new Map<string, ProjectRef>()
  for (const ref of [
    ...registryProjects.filter((project) => project.host === 'local'),
    ...scanRoots,
    ...focused
  ]) {
    byId.set(projectIdFor(ref.host, ref.path), ref)
  }
  return [...byId.values()]
}

/**
 * Where the board's projects live: Orca's own list, the registry, and the extra scan roots.
 *
 * The refresh needs the same list the board reads — the agent has to be told about the projects
 * on other hosts, because nothing on this machine can see them.
 */
export type BoardProjects = {
  /** Every workspace Orca reports. */
  workspaces: WorkspaceRow[]
  /** Every project the board knows, on every host. */
  projects: ProjectRef[]
  /** The registry as it stands, or the fallback derived from Orca's workspaces. */
  registry: Registry
  /** The extra local roots the setting names. */
  scanRoots: ProjectRef[]
  /** The projects Orca itself lists. */
  orcaProjects: ProjectRow[]
}

/** The projects the board knows, and where they live. */
export async function boardProjects(
  orca: OrcaWorkerApi,
  settings: Settings,
  warnings: string[]
): Promise<BoardProjects> {
  const { registry: stored, warning } = await readRegistry()
  if (warning !== null) {
    warnings.push(warning)
  }
  const workspaces = await listWorkspaces(orca, warnings)
  const orcaProjects = await listProjects(orca, workspaces, warnings)
  let registry = stored
  if (registry === null) {
    // No registry yet: the projects Orca knows are the fallback, and they are written back once
    // so the person can add the remote ones to a file.
    const refs = projectRefsFromWorkspaces(workspaces)
    registry = { schemaVersion: 1, projects: refs }
    // Only a scan that found something is written back. An empty registry would lock the board
    // empty — the file is read back as a valid registry — and only a hand-deleted file would
    // free it.
    if (refs.length > 0) {
      await writeRegistryIfAbsent(refs)
    }
  }
  const scanRoots = scanRootProjects(settings.scanRoots, warnings)
  return {
    workspaces,
    orcaProjects,
    registry,
    scanRoots,
    projects: knownProjectRefs(orcaProjects, registry.projects, scanRoots)
  }
}

/** The extra local roots the setting names; a relative path is refused, not guessed at. */
export function scanRootProjects(scanRoots: string, warnings: string[]): ProjectRef[] {
  const projects: ProjectRef[] = []
  for (const line of scanRoots.split('\n')) {
    const path = line.trim()
    if (path === '') {
      continue
    }
    if (!path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path)) {
      warnings.push(`跳过了不是绝对路径的扫描根目录：${path}`)
      continue
    }
    projects.push({ name: baseName(path), host: 'local', path })
  }
  return projects
}
