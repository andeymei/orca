// The filesystem half of the local scan: what OpenSpec and what Superpowers wrote on disk. Every
// read is guarded here — a path that is not there reads as absent, one that cannot be read
// becomes a warning — so the caller never has to catch anything.

import type { Dirent } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeTopic } from './correlation'
import { countCheckboxes, type CheckboxCount } from './markdown-tasks'
import type { SnapshotProject } from './model'

const OPENSPEC_DIR = 'openspec'
const CHANGES_DIR = 'changes'
const SPECS_DIR = 'specs'
const ARCHIVE_DIR = 'archive'
const PROPOSAL_FILE = 'proposal.md'
const DESIGN_FILE = 'design.md'
const TASKS_FILE = 'tasks.md'

/** The Superpowers folders, and the kind of artifact each one holds. */
const SUPERPOWERS_DIRS = [
  { kind: 'spec', path: 'docs/superpowers/specs' },
  { kind: 'plan', path: 'docs/superpowers/plans' }
] as const

/** A task list with no boxes in it. */
export const NO_CHECKBOXES: CheckboxCount = { done: 0, total: 0, inProgress: 0 }

/** One OpenSpec change, as the disk holds it. */
export type ChangeOnDisk = {
  /** The change's folder, relative to the project root. */
  path: string
  topic: string
  changeId: string
  hasProposal: boolean
  hasDesign: boolean
  hasTasks: boolean
  tasks: CheckboxCount
  capabilities: string[]
}

/** One Superpowers file, as the disk holds it. */
export type ArtifactOnDisk = { path: string; topic: string }

/** The codes that mean "there is nothing there", not "it could not be read". */
function isAbsent(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const isDirectory = (entry: Dirent): boolean => entry.isDirectory()
const isMarkdown = (entry: Dirent): boolean =>
  !entry.isDirectory() && entry.name.toLowerCase().endsWith('.md')

/**
 * Reads a directory. Null when it is not there; an empty listing and a warning when it is there
 * but cannot be read. The board states facts, and a directory that exists exists even when its
 * contents are out of reach: reporting "there is no OpenSpec here" would be the wrong fact.
 */
async function readDirectory(dir: string, warnings: string[]): Promise<Dirent[] | null> {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (isAbsent(error)) {
      return null
    }
    warnings.push(`无法读取 ${dir}：${messageOf(error)}`)
    return []
  }
}

/**
 * Whether a file is there. `stat` answers that without loading the file: a proposal can be huge,
 * and the board only asks whether it exists.
 */
async function fileExists(file: string, warnings: string[]): Promise<boolean> {
  try {
    await stat(file)
    return true
  } catch (error) {
    if (!isAbsent(error)) {
      warnings.push(`无法读取 ${file}：${messageOf(error)}`)
    }
    return false
  }
}

/** Reads a file's text; null when it is not there, and a warning when it cannot be read. */
async function readFileText(file: string, warnings: string[]): Promise<string | null> {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if (!isAbsent(error)) {
      warnings.push(`无法读取 ${file}：${messageOf(error)}`)
    }
    return null
  }
}

/** The names in a listing that pass a filter, sorted, so a scan reads the same twice. */
function namesOf(entries: readonly Dirent[], keep: (entry: Dirent) => boolean): string[] {
  return entries
    .filter(keep)
    .map((entry) => entry.name)
    .sort()
}

/** Why the project path cannot be scanned, or null when it can. */
export async function rootProblem(path: string): Promise<string | null> {
  try {
    const info = await stat(path)
    return info.isDirectory() ? null : `路径不是目录：${path}`
  } catch (error) {
    return `路径不可读：${path}（${messageOf(error)}）`
  }
}

/** The checkboxes in a file; a file that cannot be read counts as no boxes. */
export async function countBoxes(file: string, warnings: string[]): Promise<CheckboxCount> {
  const text = await readFileText(file, warnings)
  return text === null ? NO_CHECKBOXES : countCheckboxes(text)
}

/** One OpenSpec change: the three files it owns, and the capabilities it changes. */
async function readChange(
  changeDir: string,
  changeId: string,
  warnings: string[]
): Promise<ChangeOnDisk> {
  const tasksFile = join(changeDir, TASKS_FILE)
  const [hasProposal, hasDesign, hasTasks] = await Promise.all([
    fileExists(join(changeDir, PROPOSAL_FILE), warnings),
    fileExists(join(changeDir, DESIGN_FILE), warnings),
    fileExists(tasksFile, warnings)
  ])
  const delta = await readDirectory(join(changeDir, SPECS_DIR), warnings)
  return {
    path: `${OPENSPEC_DIR}/${CHANGES_DIR}/${changeId}`,
    topic: normalizeTopic(changeId),
    changeId,
    hasProposal,
    hasDesign,
    hasTasks,
    tasks: hasTasks ? await countBoxes(tasksFile, warnings) : NO_CHECKBOXES,
    capabilities: delta === null ? [] : namesOf(delta, isDirectory)
  }
}

/** The OpenSpec side of a project: the changes in flight and the capabilities that exist. */
export async function scanOpenspec(
  root: string,
  warnings: string[]
): Promise<{ facts: SnapshotProject['openspec']; changes: ChangeOnDisk[] }> {
  const changesRoot = join(root, OPENSPEC_DIR, CHANGES_DIR)
  const specsRoot = join(root, OPENSPEC_DIR, SPECS_DIR)
  const changesDir = await readDirectory(changesRoot, warnings)
  const specsDir = await readDirectory(specsRoot, warnings)
  const archive = await readDirectory(join(changesRoot, ARCHIVE_DIR), warnings)
  const changeIds =
    changesDir === null
      ? []
      : namesOf(changesDir, isDirectory).filter((name) => name !== ARCHIVE_DIR)
  const found: ChangeOnDisk[] = []
  for (const changeId of changeIds) {
    found.push(await readChange(join(changesRoot, changeId), changeId, warnings))
  }
  const present = changesDir !== null || specsDir !== null
  return {
    facts: present
      ? {
          present: true,
          capabilities: specsDir === null ? [] : namesOf(specsDir, isDirectory),
          activeChanges: found.length,
          archived: archive === null ? 0 : namesOf(archive, isDirectory).length
        }
      : null,
    changes: found
  }
}

/** The Superpowers side of a project: the design specs and the plans it holds. */
export async function scanSuperpowers(
  root: string,
  warnings: string[]
): Promise<{
  facts: SnapshotProject['superpowers']
  specs: ArtifactOnDisk[]
  plans: ArtifactOnDisk[]
}> {
  const found: Record<'spec' | 'plan', ArtifactOnDisk[]> = { spec: [], plan: [] }
  let present = false
  for (const dir of SUPERPOWERS_DIRS) {
    const entries = await readDirectory(join(root, dir.path), warnings)
    if (entries === null) {
      continue
    }
    present = true
    found[dir.kind] = namesOf(entries, isMarkdown).map((name) => ({
      path: `${dir.path}/${name}`,
      topic: normalizeTopic(name)
    }))
  }
  return {
    facts: present ? { present: true, specs: found.spec.length, plans: found.plan.length } : null,
    specs: found.spec,
    plans: found.plan
  }
}
