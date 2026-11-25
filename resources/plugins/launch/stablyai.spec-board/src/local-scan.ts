// Turns what is on disk into what the board shows: the facts of one project, and the items its
// two frameworks' work makes. Facts only — the board's judgment is derived elsewhere. A path that
// cannot be read becomes an error on that one project, never a thrown scan, because one bad
// registry entry must not blank the whole board.

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

/** What the two sides say about one topic, gathered into one board item. */
type TopicBucket = { changes: ChangeOnDisk[]; specs: ArtifactOnDisk[]; plans: ArtifactOnDisk[] }

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
  const bucketFor = (topic: string, path: string): TopicBucket | null => {
    if (topic === '') {
      warnings.push(`跳过了没有主题的内容：${path}`)
      return null
    }
    const existing = buckets.get(topic)
    if (existing) {
      return existing
    }
    const created: TopicBucket = { changes: [], specs: [], plans: [] }
    buckets.set(topic, created)
    return created
  }
  for (const change of openspec.changes) {
    const bucket = bucketFor(change.topic, change.path)
    if (bucket) {
      bucket.changes.push(change)
    }
  }
  for (const spec of superpowers.specs) {
    const bucket = bucketFor(spec.topic, spec.path)
    if (bucket) {
      bucket.specs.push(spec)
    }
  }
  for (const plan of superpowers.plans) {
    const bucket = bucketFor(plan.topic, plan.path)
    if (bucket) {
      bucket.plans.push(plan)
    }
  }

  const items: SnapshotItem[] = []
  for (const topic of [...buckets.keys()].sort()) {
    const bucket = buckets.get(topic)!
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
    const planTasks = plan === null ? NO_CHECKBOXES : await countBoxes(root, plan.path, warnings)
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
    // Every read is guarded in the artifacts module, so this is the backstop: a project that
    // cannot be scanned is one card with an error, not a board that fails to render.
    const message = `扫描失败：${input.path}（${messageOf(error)}）`
    return { project: { ...project, error: message }, items: [], warnings: [...warnings, message] }
  }
}
