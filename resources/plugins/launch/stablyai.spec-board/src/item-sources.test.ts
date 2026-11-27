import { afterEach, assert, test } from 'orca/testing'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { itemSources } from './item-sources'
import { scanProject } from './local-scan'
import type { SnapshotItem } from './model'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

/** Whether a file is there. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** A work item whose OpenSpec side holds a full change. */
function item(overrides: Partial<SnapshotItem> = {}): SnapshotItem {
  return {
    id: 'local|/repo#add-x',
    projectId: 'local|/repo',
    title: 'add-x',
    topic: 'add-x',
    openspec: {
      changeId: 'add-x',
      stage: 'implementing',
      hasProposal: true,
      hasDesign: true,
      hasTasks: true,
      tasksDone: 0,
      tasksInProgress: 0,
      tasksTotal: 3,
      capabilities: []
    },
    superpowers: null,
    ...overrides
  }
}

/** The paths of the files an item can be opened from. */
function pathsOf(entry: SnapshotItem): string[] {
  return itemSources(entry).map((source) => source.path)
}

test('a change opens the files it has', () => {
  assert.deepEqual(pathsOf(item()), [
    'openspec/changes/add-x/proposal.md',
    'openspec/changes/add-x/design.md',
    'openspec/changes/add-x/tasks.md'
  ])
})

test('a change opens only the files that are there', () => {
  const entry = item({
    openspec: {
      changeId: 'add-x',
      stage: 'implementing',
      hasProposal: true,
      hasDesign: false,
      hasTasks: true,
      tasksDone: 0,
      tasksInProgress: 0,
      tasksTotal: 3,
      capabilities: []
    }
  })
  assert.deepEqual(pathsOf(entry), [
    'openspec/changes/add-x/proposal.md',
    'openspec/changes/add-x/tasks.md'
  ])
})

test('an archived change opens its files under the archive', () => {
  const entry = item({
    openspec: {
      changeId: 'add-x',
      stage: 'archived',
      hasProposal: true,
      hasDesign: false,
      hasTasks: false,
      tasksDone: 3,
      tasksInProgress: 0,
      tasksTotal: 3,
      capabilities: []
    }
  })
  assert.deepEqual(pathsOf(entry), ['openspec/changes/archive/add-x/proposal.md'])
})

test('the Superpowers side opens its design spec and its plan', () => {
  const entry = item({
    openspec: null,
    superpowers: {
      designSpec: 'docs/superpowers/specs/add-x-design.md',
      plan: 'docs/superpowers/plans/add-x.md',
      stage: 'planned',
      planDone: 0,
      planInProgress: 0,
      planTotal: 3,
      verification: null
    }
  })
  assert.deepEqual(pathsOf(entry), [
    'docs/superpowers/specs/add-x-design.md',
    'docs/superpowers/plans/add-x.md'
  ])
})

test('the design comes before the task list, the way the work happens', () => {
  const entry = item({
    superpowers: {
      designSpec: 'docs/superpowers/specs/add-x-design.md',
      plan: 'docs/superpowers/plans/add-x.md',
      stage: 'planned',
      planDone: 0,
      planInProgress: 0,
      planTotal: 3,
      verification: null
    }
  })
  assert.deepEqual(pathsOf(entry), [
    'openspec/changes/add-x/proposal.md',
    'openspec/changes/add-x/design.md',
    'docs/superpowers/specs/add-x-design.md',
    'openspec/changes/add-x/tasks.md',
    'docs/superpowers/plans/add-x.md'
  ])
})

test('a change id that is not a safe name opens nothing', () => {
  const entry = item({
    openspec: {
      changeId: '../../etc',
      stage: 'implementing',
      hasProposal: true,
      hasDesign: true,
      hasTasks: true,
      tasksDone: 0,
      tasksInProgress: 0,
      tasksTotal: 3,
      capabilities: []
    }
  })
  assert.deepEqual(pathsOf(entry), [])
})

test('a path that climbs out of the project opens nothing', () => {
  const entry = item({
    openspec: null,
    superpowers: {
      designSpec: '../../../etc/passwd',
      plan: '/etc/passwd',
      stage: 'designed',
      planDone: 0,
      planInProgress: 0,
      planTotal: 0,
      verification: null
    }
  })
  assert.deepEqual(pathsOf(entry), [])
})

test('the file names are the names a person recognizes', () => {
  const sources = itemSources(
    item({
      superpowers: {
        designSpec: 'docs/superpowers/specs/2026-11-27-add-x-design.md',
        plan: 'docs/superpowers/plans/2026-11-27-add-x.md',
        stage: 'planned',
        planDone: 0,
        planInProgress: 0,
        planTotal: 3,
        verification: null
      }
    })
  )
  assert.deepEqual(
    sources.map((source) => source.label),
    ['proposal.md', 'design.md', '2026-11-27-add-x-design.md', 'tasks.md', '2026-11-27-add-x.md']
  )
})

test('a work item with no artifacts opens nothing', () => {
  assert.deepEqual(pathsOf(item({ openspec: null, superpowers: null })), [])
})

test('every file the board offers is a file the scan found', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spec-board-sources-'))
  roots.push(root)
  await mkdir(join(root, 'openspec/changes/add-x'), { recursive: true })
  await writeFile(join(root, 'openspec/changes/add-x/proposal.md'), '# Change\n')
  await mkdir(join(root, 'openspec/changes/archive/2026-11-01-old'), { recursive: true })
  await writeFile(join(root, 'openspec/changes/archive/2026-11-01-old/proposal.md'), '# Old\n')
  await mkdir(join(root, 'docs/superpowers/specs'), { recursive: true })
  await writeFile(join(root, 'docs/superpowers/specs/2026-11-20-add-x-design.md'), '# Design\n')

  const scan = await scanProject({ name: 'demo', host: 'local', path: root })
  assert.ok(scan.items.length > 0)
  for (const entry of scan.items) {
    for (const source of itemSources(entry)) {
      // The derivation and the scan agree on the layout: a link opens a file that is there.
      assert.equal(await exists(join(root, source.path)), true, `${source.path} is not there`)
    }
  }
})
