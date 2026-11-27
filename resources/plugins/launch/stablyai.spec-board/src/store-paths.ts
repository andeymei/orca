// Where the board keeps its own files: the snapshot the agent writes, the registry of the
// projects to scan, and the prompt of the last refresh. `SPEC_BOARD_HOME` overrides the
// directory, so a test can point the whole plugin at a temporary one.
//
// The registry is the one file a person may edit by hand, so it is read defensively: a file that
// is not there is not an error, and a file that cannot be read or does not have the shape is a
// warning and no registry — never a thrown error, because one bad file must not blank the board.

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ProjectRef } from './model'
import { errorCode, isRecord } from './unknown-values'

/** The directory the plugin keeps its files in. */
export function boardStoreDir(): string {
  return process.env.SPEC_BOARD_HOME ?? join(homedir(), '.orca', 'spec-board')
}

/** The snapshot the agent writes. */
export function snapshotPath(): string {
  return join(boardStoreDir(), 'board.json')
}

/** The registry of the projects to scan. */
export function registryPath(): string {
  return join(boardStoreDir(), 'projects.json')
}

/**
 * The list of projects this refresh scans.
 *
 * The worker writes it before the agent starts: Orca knows the projects of every host it reaches,
 * and the agent can only be told about them through a file — the prompt it is handed has room for
 * the task and the schema, and nothing else.
 */
export function scanListPath(): string {
  return join(boardStoreDir(), 'scan-list.json')
}

/** The prompt of the last refresh, kept so a person can read what the agent was asked. */
export function refreshPromptPath(): string {
  return join(boardStoreDir(), 'last-refresh-prompt.md')
}

/**
 * How far the refresh in flight has come.
 *
 * The agent writes it after every project it scans, so the panel can draw a bar that moves
 * instead of a board that sits still while the agent works.
 */
export function progressPath(): string {
  return join(boardStoreDir(), 'progress.json')
}

/**
 * A file name for a project id.
 *
 * A project's id is a host and a path (`ssh:yolo|C:/work/app`), and neither is a file name: the
 * path holds a separator and the host holds a colon. The name is a digest of the id, so it is
 * short, safe, and the same for the same project every time — a refresh of one project writes
 * over the last one's file instead of piling files up.
 */
export function projectFileKey(projectId: string): string {
  return createHash('sha256').update(projectId).digest('hex').slice(0, 16)
}

/**
 * The snapshot of one project.
 *
 * A refresh of one project writes here, not into the board's snapshot: the board's file holds
 * every project, and a refresh of one project must not cost the board the others. The plugin
 * merges this file into the board's snapshot once it lands.
 */
export function projectSnapshotPath(projectId: string): string {
  return join(boardStoreDir(), `project-${projectFileKey(projectId)}.json`)
}

/**
 * The list a refresh of one project hands the agent.
 *
 * It is a file of its own, so a refresh of one project and a refresh of the whole board never
 * read each other's list: the agent reads the list when it starts, and a list that changed
 * under it would change what it collects.
 */
export function projectScanListPath(projectId: string): string {
  return join(boardStoreDir(), `scan-list-${projectFileKey(projectId)}.json`)
}

/**
 * A JSON file, or null when there is none to read.
 *
 * A file that is not there, not JSON, or not readable is no file: the caller decides what a
 * missing file means, and a broken one never becomes an exception that blanks the board.
 */
export async function readJsonFile(path: string): Promise<unknown> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return null
  }
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * When a file was written, or null when there is none to read.
 *
 * The time the file was written is the time the facts in it were collected: the agent says when
 * it scanned, but what it says is only a claim, while the file's own time is not.
 */
export async function fileTime(path: string): Promise<number | null> {
  try {
    const info = await stat(path)
    return info.mtimeMs
  } catch {
    return null
  }
}

/**
 * Writes a JSON file in two steps: into a temporary file, then renamed over the real one.
 *
 * A reader never sees half a file — the same rule the agent follows when it writes the board's
 * snapshot, and for the same reason.
 */
export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

/** The registry: the projects to scan, one entry each. */
export type Registry = { schemaVersion: 1; projects: ProjectRef[] }

/** Whether an error means "the file is not there" rather than "the file could not be read". */
function isAbsent(error: unknown): boolean {
  const code = errorCode(error)
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/** Whether an error means "the file is already there". */
function isFileThere(error: unknown): boolean {
  return errorCode(error) === 'EEXIST'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A project entry: a name, a host and a path, all non-empty strings. */
function readProjectRef(value: unknown): ProjectRef | null {
  if (!isRecord(value)) {
    return null
  }
  const name = value['name']
  const host = value['host']
  const path = value['path']
  if (
    typeof name !== 'string' ||
    name.trim() === '' ||
    typeof host !== 'string' ||
    host.trim() === '' ||
    typeof path !== 'string' ||
    path.trim() === ''
  ) {
    return null
  }
  return { name, host, path }
}

/**
 * The registry in a raw JSON value, or null when the value is not one. Every entry has to be a
 * project: one broken entry would leave the board showing half a registry, and a half registry is
 * harder to reason about than none — the worker falls back to the workspaces Orca reports, and
 * the warning says what to fix.
 */
function parseRegistry(raw: unknown): Registry | null {
  if (!isRecord(raw)) {
    return null
  }
  const entries = raw['projects']
  if (raw['schemaVersion'] !== 1 || !Array.isArray(entries)) {
    return null
  }
  const projects: ProjectRef[] = []
  for (const entry of entries) {
    const project = readProjectRef(entry)
    if (project === null) {
      return null
    }
    projects.push(project)
  }
  return { schemaVersion: 1, projects }
}

/**
 * The registry on disk. A file that is not there is not a warning — the board simply has no
 * registry yet — and a file that cannot be read or does not have the shape is a warning that
 * names the file, so the person can find it.
 */
export async function readRegistry(): Promise<{
  registry: Registry | null
  warning: string | null
}> {
  const path = registryPath()
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (isAbsent(error)) {
      return { registry: null, warning: null }
    }
    return { registry: null, warning: `项目注册表无法读取：${path}（${messageOf(error)}）` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { registry: null, warning: `项目注册表不是合法的 JSON：${path}（${messageOf(error)}）` }
  }
  const registry = parseRegistry(parsed)
  if (registry === null) {
    return {
      registry: null,
      warning: `项目注册表格式不对：${path}（期望 schemaVersion 为 1，projects 为项目数组，每项有 name、host、path）`
    }
  }
  if (registry.projects.length === 0) {
    // An empty registry is no registry: it would lock the board empty, and only a hand-deleted
    // file would free it. The fallback is derived again instead, so the projects are still on the
    // board — and the file is filled in, because an empty file is nobody's intent.
    return { registry: null, warning: null }
  }
  return { registry, warning: null }
}

/**
 * Writes the registry when there is none, and when the one there is empty.
 *
 * A registry a person edited is theirs: it is never overwritten. One that holds no project at all
 * is a dead end — the board would be empty and only a hand-deleted file would free it — so it is
 * filled with the projects Orca knows.
 */
export async function writeRegistryIfAbsent(projects: readonly ProjectRef[]): Promise<void> {
  const path = registryPath()
  try {
    await mkdir(boardStoreDir(), { recursive: true })
    // 'wx' refuses to overwrite: a registry a person edited in the meantime is theirs, and the
    // file is written in one step rather than checked and then written.
    await writeFile(path, `${JSON.stringify({ schemaVersion: 1, projects }, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx'
    })
    return
  } catch (error) {
    if (!isFileThere(error)) {
      // The board works without a registry: the fallback is derived again next time.
      console.error('[spec-board] 无法写入项目注册表', error)
      return
    }
  }
  // The file is there. An empty one is filled in; one with projects is the person's.
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return
  }
  if (parseRegistry(parsed)?.projects.length !== 0) {
    return
  }
  try {
    await writeFile(path, `${JSON.stringify({ schemaVersion: 1, projects }, null, 2)}\n`, 'utf8')
  } catch (error) {
    console.error('[spec-board] 无法写入项目注册表', error)
  }
}
