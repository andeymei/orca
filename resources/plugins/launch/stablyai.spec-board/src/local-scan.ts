// Turns what is on disk into what the board shows: the facts of one project, and the items its
// two frameworks' work makes. Facts only — the board's judgment is derived elsewhere. A path that
// cannot be read becomes an error on that one project, never a thrown scan, because one bad
// registry entry must not blank the whole board.

import { correlate } from './correlation'
import {
  countBoxes,
  messageOf,
  NO_CHECKBOXES,
  rootProblem,
  scanOpenspec,
  scanSuperpowers,
  type ArtifactOnDisk,
  type ChangeOnDisk
} from './local-scan-artifacts'
import type { CheckboxCount } from './markdown-tasks'
import type { OpenspecFacts, SnapshotItem, SnapshotProject, SuperpowersFacts } from './model'

/** What one scan of one project found. */
export type ScanProjectResult = {
  project: SnapshotProject
  items: SnapshotItem[]
  warnings: string[]
}

/** One topic of the OpenSpec side: the change that owns it. */
type OpenspecTopic = { topic: string; change: ChangeOnDisk }

/** One topic of the Superpowers side: the design spec and the plan that own it. */
type SuperpowersTopic = {
  topic: string
  spec: ArtifactOnDisk | null
  plan: ArtifactOnDisk | null
  /** The file name the topic came from: the pairing normalizes a name itself. */
  source: string
}

function openspecFacts(change: ChangeOnDisk): OpenspecFacts {
  const { done, inProgress, total } = change.tasks
  const started = done + inProgress
  let stage: OpenspecFacts['stage'] = 'proposed'
  if (change.archived) {
    stage = 'archived'
  } else if (change.hasTasks && total > 0 && done === total) {
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
 * The artifacts of one kind, grouped by their topic. The first of a topic wins; the rest are
 * reported, because a person who named two things the same should hear about it.
 */
function groupByTopic<T extends { topic: string; path: string }>(
  artifacts: readonly T[],
  label: string,
  warnings: string[]
): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const artifact of artifacts) {
    if (artifact.topic === '') {
      warnings.push(`跳过了没有主题的内容：${artifact.path}`)
      continue
    }
    const existing = groups.get(artifact.topic)
    if (existing) {
      existing.push(artifact)
    } else {
      groups.set(artifact.topic, [artifact])
    }
  }
  for (const [topic, list] of groups) {
    if (list.length > 1) {
      warnings.push(`主题重复：${topic}（${list.length} 个${label}归为一项，只用第一个）`)
    }
  }
  return groups
}

/**
 * The board items of one project. The two frameworks' work is paired by topic — the same topic
 * or a close one — so a change and the plan that covers it land on one card, and work only one
 * side knows about still gets a card of its own.
 *
 * The pairing is a maximum-cardinality matching, not a greedy walk: a greedy walk strands work
 * that could have been paired, and a stranded artifact is reported as a gap — a false warning
 * about work the user did.
 */
async function buildItems(
  projectId: string,
  root: string,
  openspec: { changes: ChangeOnDisk[] },
  superpowers: { specs: ArtifactOnDisk[]; plans: ArtifactOnDisk[] },
  warnings: string[]
): Promise<SnapshotItem[]> {
  const changeGroups = groupByTopic(openspec.changes, '变更', warnings)
  const specGroups = groupByTopic(superpowers.specs, '设计', warnings)
  const planGroups = groupByTopic(superpowers.plans, '计划', warnings)

  const openspecTopics: OpenspecTopic[] = [...changeGroups.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([topic, list]) => ({ topic, change: list[0]! }))

  const superpowersTopics = new Map<string, SuperpowersTopic>()
  for (const [topic, list] of specGroups) {
    const spec = list[0]!
    superpowersTopics.set(topic, { topic, spec, plan: null, source: spec.name })
  }
  for (const [topic, list] of planGroups) {
    const plan = list[0]!
    const existing = superpowersTopics.get(topic)
    if (existing) {
      existing.plan = plan
    } else {
      superpowersTopics.set(topic, { topic, spec: null, plan, source: plan.name })
    }
  }

  const pairing = correlate(
    openspecTopics.map((entry) => ({
      id: entry.change.changeId,
      topic: entry.change.changeId
    })),
    [...superpowersTopics.values()].map((entry) => ({ id: entry.topic, topic: entry.source }))
  )
  const superpowersOf = new Map<string, SuperpowersTopic>()
  for (const match of pairing.matches) {
    const entry = superpowersTopics.get(match.superpowersId)
    if (entry) {
      superpowersOf.set(match.openspecId, entry)
    }
  }

  const items: SnapshotItem[] = []
  for (const entry of openspecTopics) {
    items.push(
      await buildItem(
        projectId,
        root,
        entry.topic,
        entry.change,
        superpowersOf.get(entry.change.changeId) ?? null,
        warnings
      )
    )
  }
  const unmatched = new Set(pairing.unmatchedSuperpowers)
  for (const entry of superpowersTopics.values()) {
    if (!unmatched.has(entry.topic)) {
      continue
    }
    items.push(await buildItem(projectId, root, entry.topic, null, entry, warnings))
  }
  return items.sort((left, right) =>
    left.topic < right.topic ? -1 : left.topic > right.topic ? 1 : 0
  )
}

/**
 * One board item: what the two sides say about one piece of work. The item's topic is the
 * OpenSpec one when there is one — the change id is what the commands act on, so it is the more
 * stable name — and the Superpowers one otherwise.
 */
async function buildItem(
  projectId: string,
  root: string,
  topic: string,
  change: ChangeOnDisk | null,
  superpowers: SuperpowersTopic | null,
  warnings: string[]
): Promise<SnapshotItem> {
  const plan = superpowers?.plan ?? null
  const planTasks = plan === null ? NO_CHECKBOXES : await countBoxes(root, plan.path, warnings)
  return {
    id: `${projectId}#${topic}`,
    projectId,
    title: change?.changeId ?? topic,
    topic,
    openspec: change === null ? null : openspecFacts(change),
    superpowers:
      superpowers === null
        ? null
        : superpowersFacts(superpowers.spec, superpowers.plan, planTasks)
  }
}

/** The id a project keeps across scans: the host it lives on, and where. */
export function projectIdFor(host: string, path: string): string {
  return `${host}|${path}`
}

/**
 * A project that could not be scanned.
 *
 * The failure is the project's, and only the project's: the board's own warnings are about the
 * board, and a fact in two places reads as two facts. The warnings the scan collected on the way
 * stay — they are about the project's contents, not about its failure.
 *
 * The scan time goes too: the scan did not happen, so the project has no scan time. The time of
 * the attempt is not the time of a scan.
 */
function failed(
  project: SnapshotProject,
  error: string,
  warnings: string[]
): ScanProjectResult {
  return { project: { ...project, scannedAt: '', error }, items: [], warnings }
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
    return failed(project, problem, warnings)
  }
  try {
    const openspec = await scanOpenspec(input.path, warnings)
    const superpowers = await scanSuperpowers(input.path, warnings)
    project.openspec = openspec.facts
    project.superpowers = superpowers.facts
    const items = await buildItems(projectId, input.path, openspec, superpowers, warnings)
    return { project, items, warnings }
  } catch (error) {
    // Every read is guarded in the artifacts module, so this is the backstop: a project that
    // cannot be scanned is one card with an error, not a board that fails to render.
    return failed(project, `扫描失败：${input.path}（${messageOf(error)}）`, warnings)
  }
}
