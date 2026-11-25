// The filesystem half of the local scan: what OpenSpec and what Superpowers wrote on disk. Every
// read is guarded here — a path that is not there reads as absent, one that cannot be read
// becomes a warning — so the caller never has to catch anything.

import type { Dirent } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeTopic } from './correlation'
import { countCheckboxes, type CheckboxCount } from './markdown-tasks'
import type { SnapshotProject } from './model'
import { errorCode } from './unknown-values'

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
  /** Whether the change sits in `changes/archive/` — it is done, not in flight. */
  archived: boolean
  hasProposal: boolean
  hasDesign: boolean
  hasTasks: boolean
  tasks: CheckboxCount
  capabilities: string[]
}

/** One Superpowers file, as the disk holds it. */
export type ArtifactOnDisk = { path: string; topic: string; name: string }

/** The codes that mean "there is nothing there", not "it could not be read". */
function isAbsent(error: unknown): boolean {
  const code = errorCode(error)
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
async function readDirectory(
  root: string,
  relative: string,
  warnings: string[]
): Promise<Dirent[] | null> {
  const dir = join(root, relative)
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
async function fileExists(root: string, relative: string, warnings: string[]): Promise<boolean> {
  const file = join(root, relative)
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
async function readFileText(
  root: string,
  relative: string,
  warnings: string[]
): Promise<string | null> {
  const file = join(root, relative)
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

/** The checkboxes in a file under the project root; a file that cannot be read counts as none. */
export async function countBoxes(
  root: string,
  relative: string,
  warnings: string[]
): Promise<CheckboxCount> {
  const text = await readFileText(root, relative, warnings)
  return text === null ? NO_CHECKBOXES : countCheckboxes(text)
}

/** One OpenSpec change: the three files it owns, and the capabilities it changes. */
async function readChange(
  root: string,
  relative: string,
  changeId: string,
  archived: boolean,
  warnings: string[]
): Promise<ChangeOnDisk> {
  // The task list is named once, and both the existence check and the count read that name: two
  // derivations of one file could drift, and then the board would say a change has tasks while
  // counting none.
  const tasks = `${relative}/${TASKS_FILE}`
  const [hasProposal, hasDesign, hasTasks] = await Promise.all([
    fileExists(root, `${relative}/${PROPOSAL_FILE}`, warnings),
    fileExists(root, `${relative}/${DESIGN_FILE}`, warnings),
    fileExists(root, tasks, warnings)
  ])
  const delta = await readDirectory(root, `${relative}/${SPECS_DIR}`, warnings)
  return {
    path: relative,
    topic: normalizeTopic(changeId),
    changeId,
    archived,
    hasProposal,
    hasDesign,
    hasTasks,
    tasks: hasTasks ? await countBoxes(root, tasks, warnings) : NO_CHECKBOXES,
    capabilities: delta === null ? [] : namesOf(delta, isDirectory)
  }
}

/** The OpenSpec side of a project: the changes in flight, the archived ones, and the capabilities. */
export async function scanOpenspec(
  root: string,
  warnings: string[]
): Promise<{ facts: SnapshotProject['openspec']; changes: ChangeOnDisk[] }> {
  const changes = `${OPENSPEC_DIR}/${CHANGES_DIR}`
  const changesDir = await readDirectory(root, changes, warnings)
  const specsDir = await readDirectory(root, `${OPENSPEC_DIR}/${SPECS_DIR}`, warnings)
  const archive = await readDirectory(root, `${changes}/${ARCHIVE_DIR}`, warnings)
  const changeIds =
    changesDir === null
      ? []
      : namesOf(changesDir, isDirectory).filter((name) => name !== ARCHIVE_DIR)
  const archivedIds = archive === null ? [] : namesOf(archive, isDirectory)
  const found: ChangeOnDisk[] = []
  for (const changeId of changeIds) {
    found.push(await readChange(root, `${changes}/${changeId}`, changeId, false, warnings))
  }
  // An archived change is a change: it left `changes/` for `changes/archive/`, and the board
  // still shows it — in the archive stage, and with the gap that says its spec never arrived.
  for (const changeId of archivedIds) {
    found.push(
      await readChange(root, `${changes}/${ARCHIVE_DIR}/${changeId}`, changeId, true, warnings)
    )
  }
  const present = changesDir !== null || specsDir !== null
  return {
    facts: present
      ? {
          present: true,
          capabilities: specsDir === null ? [] : namesOf(specsDir, isDirectory),
          activeChanges: found.filter((change) => !change.archived).length,
          archived: archivedIds.length
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
    const entries = await readDirectory(root, dir.path, warnings)
    if (entries === null) {
      continue
    }
    present = true
    found[dir.kind] = namesOf(entries, isMarkdown).map((name) => ({
      path: `${dir.path}/${name}`,
      topic: normalizeTopic(name),
      name
    }))
  }
  return {
    facts: present ? { present: true, specs: found.spec.length, plans: found.plan.length } : null,
    specs: found.spec,
    plans: found.plan
  }
}
