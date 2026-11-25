// Where the board keeps its own files: the snapshot the agent writes, the registry of the
// projects to scan, and the prompt of the last refresh. `SPEC_BOARD_HOME` overrides the
// directory, so a test can point the whole plugin at a temporary one.
//
// The registry is the one file a person may edit by hand, so it is read defensively: a file that
// is not there is not an error, and a file that cannot be read or does not have the shape is a
// warning and no registry — never a thrown error, because one bad file must not blank the board.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ProjectRef } from './model'

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

/** The prompt of the last refresh, kept so a person can read what the agent was asked. */
export function refreshPromptPath(): string {
  return join(boardStoreDir(), 'last-refresh-prompt.md')
}

/** The registry: the projects to scan, one entry each. */
export type Registry = { schemaVersion: 1; projects: ProjectRef[] }

/** Whether an error means "the file is not there" rather than "the file could not be read". */
function isAbsent(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A project entry: a name, a host and a path, all non-empty strings. */
function readProjectRef(value: unknown): ProjectRef | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const entry = value as Record<string, unknown>
  const name = entry['name']
  const host = entry['host']
  const path = entry['path']
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
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null
  }
  const source = raw as Record<string, unknown>
  if (source['schemaVersion'] !== 1 || !Array.isArray(source['projects'])) {
    return null
  }
  const projects: ProjectRef[] = []
  for (const entry of source['projects']) {
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
  return { registry, warning: null }
}

/**
 * Writes the registry, but only when there is none: the person may have edited it, and the
 * fallback the worker derives from Orca's own workspaces must not overwrite that.
 */
export async function writeRegistryIfAbsent(projects: readonly ProjectRef[]): Promise<void> {
  const path = registryPath()
  try {
    await stat(path)
    return
  } catch (error) {
    if (!isAbsent(error)) {
      return
    }
  }
  try {
    await mkdir(boardStoreDir(), { recursive: true })
    await writeFile(path, `${JSON.stringify({ schemaVersion: 1, projects }, null, 2)}\n`, 'utf8')
  } catch (error) {
    // The board works without a registry: the fallback is derived again next time.
    console.error('[spec-board] 无法写入项目注册表', error)
  }
}
