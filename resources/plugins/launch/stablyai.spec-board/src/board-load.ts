// Loads the board: the agent's snapshot, the local scan, and the merge of the two.
//
// Everything here is a read. A file that cannot be read, a registry that is not one and a
// project that cannot be scanned become warnings on the board, never a thrown error: one bad
// project must not blank the whole board.

import { readFile, stat } from 'node:fs/promises'
import type { OrcaWorkerApi } from 'orca/worker'
import { mergeBoard, type LocalScan } from './board-merge'
import { parseBoardSnapshot } from './board-schema'
import { isSafeCommandValue } from './command-values'
import { scanProject } from './local-scan'
import type { BoardPayload, BoardSnapshot, ProjectRef, SnapshotProject } from './model'
import { cliProbe } from './openspec-cli'
import { readSpecCapabilities } from './spec-capabilities'
import { errorCode } from './unknown-values'
import {
  readRegistry,
  snapshotPath,
  writeRegistryIfAbsent,
  type Registry
} from './store-paths'
import {
  baseName,
  projectRefsFromWorkspaces,
  type WorkspaceRow
} from './workspace-match'

/** The settings the plugin owns, as plain strings. */
export type Settings = { refreshAgent: string; refreshWorkspace: string; scanRoots: string }

/** The board, and what the worker needed to build it. */
export type Board = {
  payload: BoardPayload
  workspaces: WorkspaceRow[]
  registry: Registry | null
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * A value the board shows but may not trust: a change id read out of a repository can carry
 * control characters and can be very long. The name is cleaned and clipped, so the board stays
 * readable and nothing invisible ends up in it.
 */
export function displayText(value: string): string {
  // oxlint-disable-next-line eslint/no-control-regex -- the control characters are what is dropped
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return cleaned.length > 80 ? `${cleaned.slice(0, 80)}…` : cleaned
}

/** Whether an error means "the file is not there". */
function isAbsent(error: unknown): boolean {
  const code = errorCode(error)
  return code === 'ENOENT' || code === 'ENOTDIR'
}

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
async function listWorkspaces(orca: OrcaWorkerApi, warnings: string[]): Promise<WorkspaceRow[]> {
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

/** The extra local roots the setting names; a relative path is refused, not guessed at. */
function scanRootProjects(scanRoots: string, warnings: string[]): ProjectRef[] {
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

/** When the snapshot was written, or null when there is none. */
export async function snapshotAt(): Promise<number | null> {
  try {
    const info = await stat(snapshotPath())
    return info.mtimeMs
  } catch {
    return null
  }
}

/** The snapshot on disk, and when it was written. */
async function readSnapshot(
  warnings: string[],
  state: BoardState
): Promise<{ value: BoardSnapshot | null; at: number | null }> {
  const path = snapshotPath()
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (!isAbsent(error)) {
      warnings.push(`快照无法读取：${path}（${messageOf(error)}）`)
    }
    return { value: null, at: null }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    warnings.push(`快照不是合法的 JSON：${path}（${messageOf(error)}）`)
    return lastValid(state)
  }
  const result = parseBoardSnapshot(parsed)
  if (!result.ok) {
    warnings.push(`快照不合 schema：${path}（${result.error}）`)
    return lastValid(state)
  }
  const at = await snapshotAt()
  state.lastValidSnapshot = { value: result.value, at }
  return { value: result.value, at }
}

/** The last snapshot that parsed, or nothing when there never was one. */
function lastValid(state: BoardState): { value: BoardSnapshot | null; at: number | null } {
  return {
    value: state.lastValidSnapshot?.value ?? null,
    at: state.lastValidSnapshot?.at ?? null
  }
}

/** The capability directories of every local project; a remote project has none to read. */
async function specCapabilitiesOf(
  localScans: readonly LocalScan[],
  snapshot: BoardSnapshot | null
): Promise<Map<string, string[] | undefined>> {
  const paths = new Map<string, string>()
  for (const scan of localScans) {
    if (scan.project.host === 'local') {
      paths.set(scan.project.id, scan.project.path)
    }
  }
  for (const project of snapshot?.projects ?? []) {
    if (project.host === 'local') {
      paths.set(project.id, project.path)
    }
  }
  const capabilities = new Map<string, string[] | undefined>()
  for (const [id, path] of paths) {
    capabilities.set(id, await readSpecCapabilities(path))
  }
  return capabilities
}

/**
 * The OpenSpec CLI of the local projects.
 *
 * The probe runs here, on this machine, so it is the ground truth: the agent's snapshot may
 * have been written earlier, on another machine, or before the CLI was installed, and a
 * snapshot that claims a CLI this machine does not have would offer a terminal button that runs
 * a command the user does not have. A remote project keeps the agent's answer — the CLI is on
 * the other host, and the worker cannot run it.
 */
async function applyCliProbe(
  localScans: readonly LocalScan[],
  snapshot: BoardSnapshot | null
): Promise<void> {
  const projects = [
    ...localScans.map((scan) => scan.project),
    ...(snapshot?.projects ?? [])
  ].filter((project) => project.host === 'local')
  if (projects.length === 0) {
    return
  }
  const probe = await cliProbe.read()
  for (const project of projects) {
    project.openspecCli = probe
  }
}

/**
 * What the worker keeps between its requests. The last snapshot that parsed lives here, so a
 * snapshot that no longer parses does not take the agent's half of the board with it: the error
 * card names the file and the parse error, and the board keeps what the agent last wrote down.
 */
export type BoardState = { lastValidSnapshot: { value: BoardSnapshot; at: number | null } | null }

/** The state of a worker that has not read a snapshot yet. */
export function newBoardState(): BoardState {
  return { lastValidSnapshot: null }
}

/** The board: the agent's snapshot merged over the local scan. */
export async function buildBoard(
  orca: OrcaWorkerApi,
  warnings: string[],
  state: BoardState
): Promise<Board> {
  const { registry: stored, warning } = await readRegistry()
  if (warning !== null) {
    warnings.push(warning)
  }
  const workspaces = await listWorkspaces(orca, warnings)
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
  let settings: Settings = { refreshAgent: '', refreshWorkspace: '', scanRoots: '' }
  try {
    settings = await readSettings(orca)
  } catch (error) {
    warnings.push(`无法读取插件设置：${messageOf(error)}`)
  }
  const localProjects = [
    ...registry.projects.filter((project) => project.host === 'local'),
    ...scanRootProjects(settings.scanRoots, warnings)
  ]
  const localScans: LocalScan[] = []
  for (const project of localProjects) {
    const scan = await scanProject(project)
    warnings.push(...scan.warnings)
    localScans.push({ project: scan.project, items: scan.items })
  }
  const snapshot = await readSnapshot(warnings, state)
  const specCapabilities = await specCapabilitiesOf(localScans, snapshot.value)
  await applyCliProbe(localScans, snapshot.value)
  const merged = mergeBoard({ snapshot: snapshot.value, localScans, specCapabilities })
  for (const item of merged.items) {
    const changeId = item.openspec?.changeId
    if (changeId !== undefined && !isSafeCommandValue(changeId)) {
      warnings.push(
        `变更 id 不安全：${displayText(changeId)}—— 这个工作项不提供 OpenSpec 命令，只能用字母、数字、点、短横和下划线，且以字母或数字开头`
      )
    }
  }
  const payload: BoardPayload = {
    items: merged.items,
    projects: merged.projects,
    sources: { localAt: localScans.length > 0 ? Date.now() : null, agentAt: snapshot.at },
    warnings
  }
  return { payload, workspaces, registry }
}

/**
 * The project a request names, or null. The board's projects are the authority on where a
 * project lives: an id that is not on the board names nothing, and the caller's string is never
 * read back as a host and a path — that would let the request choose the directory the command
 * runs in.
 */
export function findProject(board: Board, projectId: string): SnapshotProject | null {
  return board.payload.projects.find((entry) => entry.id === projectId) ?? null
}
