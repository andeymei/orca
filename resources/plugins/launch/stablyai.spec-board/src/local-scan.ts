// Reads one project on disk and reports what OpenSpec and what Superpowers wrote there. Facts
// only — the board's judgment is derived elsewhere. Every read is guarded: a path that cannot be
// read becomes an error on that one project, never a thrown scan, because one bad registry entry
// must not blank the whole board.

import type { Dirent } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeTopic } from './correlation'
import { countCheckboxes, type CheckboxCount } from './markdown-tasks'
import type { OpenspecFacts, SnapshotItem, SnapshotProject, SuperpowersFacts } from './model'

/** What one scan of one project found. */
export type ScanProjectResult = {
  project: SnapshotProject
  items: SnapshotItem[]
  warnings: string[]
}

const OPENSPEC_DIR = 'openspec'
const CHANGES_DIR = 'changes'
const SPECS_DIR = 'specs'
const ARCHIVE_DIR = 'archive'
const PROPOSAL_FILE = 'proposal.md'
const DESIGN_FILE = 'design.md'
const TASKS_FILE = 'tasks.md'
const NO_CHECKBOXES: CheckboxCount = { done: 0, total: 0, inProgress: 0 }

/** The Superpowers folders, and the kind of artifact each one holds. */
const SUPERPOWERS_DIRS = [
  { kind: 'spec', path: 'docs/superpowers/specs' },
  { kind: 'plan', path: 'docs/superpowers/plans' }
] as const

/** One OpenSpec change, as the disk holds it. */
type ChangeOnDisk = {
  topic: string
  changeId: string
  hasProposal: boolean
  hasDesign: boolean
  hasTasks: boolean
  tasks: CheckboxCount
  capabilities: string[]
}

/** One Superpowers file, as the disk holds it. */
type ArtifactOnDisk = { path: string; topic: string }

/** What the two sides say about one topic, gathered into one board item. */
type TopicBucket = { changes: ChangeOnDisk[]; specs: ArtifactOnDisk[]; plans: ArtifactOnDisk[] }

/** The codes that mean "there is nothing there", not "it could not be read". */
function isAbsent(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const isDirectory = (entry: Dirent): boolean => entry.isDirectory()
const isMarkdown = (entry: Dirent): boolean =>
  !entry.isDirectory() && entry.name.toLowerCase().endsWith('.md')

/**
 * Reads a directory. Null when it is not there, and a warning when it cannot be read: a missing
 * directory is ordinary, an unreadable one is worth saying out loud.
 */
async function readDirectory(dir: string, warnings: string[]): Promise<Dirent[] | null> {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (!isAbsent(error)) {
      warnings.push(`无法读取 ${dir}：${messageOf(error)}`)
    }
    return null
  }
}

/** Reads a file; null when it is not there, and a warning when it cannot be read. */
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
async function rootProblem(path: string): Promise<string | null> {
  try {
    const info = await stat(path)
    return info.isDirectory() ? null : `路径不是目录：${path}`
  } catch (error) {
    return `路径不可读：${path}（${messageOf(error)}）`
  }
}

/** One OpenSpec change: the three files it owns, and the capabilities it changes. */
async function readChange(
  changeDir: string,
  changeId: string,
  warnings: string[]
): Promise<ChangeOnDisk> {
  const [proposal, design, tasks] = await Promise.all(
    [PROPOSAL_FILE, DESIGN_FILE, TASKS_FILE].map((name) =>
      readFileText(join(changeDir, name), warnings)
    )
  )
  const delta = await readDirectory(join(changeDir, SPECS_DIR), warnings)
  return {
    topic: normalizeTopic(changeId),
    changeId,
    hasProposal: proposal !== null,
    hasDesign: design !== null,
    hasTasks: tasks !== null,
    tasks: tasks === null ? NO_CHECKBOXES : countCheckboxes(tasks),
    capabilities: delta === null ? [] : namesOf(delta, isDirectory)
  }
}

/** The OpenSpec side of a project: the changes in flight and the capabilities that exist. */
async function scanOpenspec(
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
async function scanSuperpowers(
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

function openspecFacts(change: ChangeOnDisk): OpenspecFacts {
  const { done, inProgress, total } = change.tasks
  const started = done + inProgress
  let stage: OpenspecFacts['stage'] = 'proposed'
  if (change.hasTasks && total > 0 && done === total) {
    stage = 'validated'
  } else if (change.hasTasks && started > 0) {
    stage = 'implementing'
  }
  return {
    changeId: change.changeId,
    stage,
    hasProposal: change.hasProposal,
    hasDesign: change.hasDesign,
    hasTasks: change.hasTasks,
    tasksDone: done,
    tasksInProgress: inProgress,
    tasksTotal: total,
    capabilities: change.capabilities
  }
}

function superpowersFacts(
  designSpec: ArtifactOnDisk | null,
  plan: ArtifactOnDisk | null,
  planTasks: CheckboxCount
): SuperpowersFacts {
  const { done, inProgress, total } = planTasks
  let stage: SuperpowersFacts['stage'] = 'designed'
  if (plan) {
    stage = 'planned'
    if (total > 0 && done === total) {
      stage = 'done'
    } else if (done + inProgress > 0) {
      stage = 'executing'
    }
  }
  return {
    designSpec: designSpec?.path ?? null,
    plan: plan?.path ?? null,
    stage,
    planDone: done,
    planInProgress: inProgress,
    planTotal: total
  }
}

/**
 * The board items of one project. A change, its design spec and its plan share one topic, so
 * they land on one item: the two frameworks' view of the same work belongs on the same card.
 */
async function buildItems(
  projectId: string,
  root: string,
  openspec: { changes: ChangeOnDisk[] },
  superpowers: { specs: ArtifactOnDisk[]; plans: ArtifactOnDisk[] },
  warnings: string[]
): Promise<SnapshotItem[]> {
  const buckets = new Map<string, TopicBucket>()
  const bucketFor = (topic: string): TopicBucket => {
    const existing = buckets.get(topic)
    if (existing) {
      return existing
    }
    const created: TopicBucket = { changes: [], specs: [], plans: [] }
    buckets.set(topic, created)
    return created
  }
  for (const change of openspec.changes) {
    bucketFor(change.topic).changes.push(change)
  }
  for (const spec of superpowers.specs) {
    bucketFor(spec.topic).specs.push(spec)
  }
  for (const plan of superpowers.plans) {
    bucketFor(plan.topic).plans.push(plan)
  }

  const items: SnapshotItem[] = []
  for (const topic of [...buckets.keys()].sort()) {
    const bucket = buckets.get(topic)!
    if (topic === '') {
      warnings.push('跳过了没有主题的内容：文件名无法归一化')
      continue
    }
    for (const [kind, label] of [
      ['changes', '变更'],
      ['specs', '设计'],
      ['plans', '计划']
    ] as const) {
      const list = bucket[kind]
      if (list.length > 1) {
        warnings.push(`主题重复：${topic}（${list.length} 个${label}归为一项，只用第一个）`)
      }
    }
    const change = bucket.changes[0] ?? null
    const designSpec = bucket.specs[0] ?? null
    const plan = bucket.plans[0] ?? null
    const planText = plan === null ? null : await readFileText(join(root, plan.path), warnings)
    const planTasks = planText === null ? NO_CHECKBOXES : countCheckboxes(planText)
    items.push({
      id: `${projectId}#${topic}`,
      projectId,
      title: change?.changeId ?? topic,
      topic,
      openspec: change === null ? null : openspecFacts(change),
      superpowers: designSpec || plan ? superpowersFacts(designSpec, plan, planTasks) : null
    })
  }
  return items
}

/** The id a project keeps across scans: the host it lives on, and where. */
export function projectIdFor(host: string, path: string): string {
  return `${host}|${path}`
}

/**
 * Scans one project. A path that cannot be read comes back as a project with `error` set and no
 * items: the scan never throws, because one bad registry entry must not blank the whole board.
 */
export async function scanProject(input: {
  name: string
  host: string
  path: string
}): Promise<ScanProjectResult> {
  const projectId = projectIdFor(input.host, input.path)
  const warnings: string[] = []
  const project: SnapshotProject = {
    id: projectId,
    name: input.name,
    host: input.host,
    path: input.path,
    openspec: null,
    superpowers: null,
    openspecCli: null,
    scannedAt: new Date().toISOString()
  }
  const problem = await rootProblem(input.path)
  if (problem !== null) {
    return { project: { ...project, error: problem }, items: [], warnings: [problem] }
  }
  try {
    const openspec = await scanOpenspec(input.path, warnings)
    const superpowers = await scanSuperpowers(input.path, warnings)
    project.openspec = openspec.facts
    project.superpowers = superpowers.facts
    const items = await buildItems(projectId, input.path, openspec, superpowers, warnings)
    return { project, items, warnings }
  } catch (error) {
    // Every read above is guarded, so this is the backstop: a project that cannot be scanned is
    // one card with an error, not a board that fails to render.
    const message = `扫描失败：${input.path}（${messageOf(error)}）`
    return { project: { ...project, error: message }, items: [], warnings: [...warnings, message] }
  }
}
