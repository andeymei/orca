// The merge: the agent's snapshot over the local scan. The agent's facts win where both sides
// have them, the local scan fills in the rest, and the gaps of an item are what both sides say.
import { assert, test } from 'orca/testing'
import { mergeBoard } from './board-merge'
import type { BoardSnapshot, SnapshotItem, SnapshotProject } from './model'

function project(overrides: Partial<SnapshotProject> = {}): SnapshotProject {
  return {
    id: 'local|/repo',
    name: 'repo',
    host: 'local',
    path: '/repo',
    openspec: { present: true, capabilities: ['core'], activeChanges: 1, archived: 0 },
    superpowers: null,
    openspecCli: { available: true },
    scannedAt: '2026-11-25T10:00:00.000Z',
    ...overrides
  }
}

function item(overrides: Partial<SnapshotItem> = {}): SnapshotItem {
  return {
    id: 'local|/repo#add-x',
    projectId: 'local|/repo',
    title: 'Add X',
    topic: 'add-x',
    openspec: {
      changeId: 'add-x',
      stage: 'implementing',
      hasProposal: true,
      hasDesign: true,
      hasTasks: true,
      tasksDone: 1,
      tasksInProgress: 0,
      tasksTotal: 4,
      capabilities: []
    },
    superpowers: null,
    ...overrides
  }
}

function snapshot(overrides: Partial<BoardSnapshot> = {}): BoardSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: '2026-11-25T10:00:00.000Z',
    generatedBy: { agent: 'claude' },
    projects: [],
    items: [],
    ...overrides
  }
}

test('the agent snapshot wins over the local scan for the same project', () => {
  const merged = mergeBoard({
    snapshot: snapshot({ projects: [project({ name: 'from-the-agent' })] }),
    localScans: [{ project: project({ name: 'from-the-scan' }), items: [] }],
    specCapabilities: new Map(),
    knownProjects: []
  })
  assert.equal(merged.projects.length, 1)
  assert.equal(merged.projects[0]!.name, 'from-the-agent')
})

test('a project only the local scan saw is on the board', () => {
  const merged = mergeBoard({
    snapshot: snapshot(),
    localScans: [
      { project: project({ id: 'local|/other', name: 'other', path: '/other' }), items: [] }
    ],
    specCapabilities: new Map(),
    knownProjects: []
  })
  assert.deepEqual(
    merged.projects.map((entry) => entry.id),
    ['local|/other']
  )
})

test('an item the agent covered takes the agent facts', () => {
  const merged = mergeBoard({
    snapshot: snapshot({ items: [item({ title: 'from-the-agent' })] }),
    localScans: [{ project: project(), items: [item({ title: 'from-the-scan' })] }],
    specCapabilities: new Map(),
    knownProjects: []
  })
  assert.equal(merged.items.length, 1)
  assert.equal(merged.items[0]!.title, 'from-the-agent')
})

test('the gaps of an item are what both sides say, one per code', () => {
  const merged = mergeBoard({
    snapshot: snapshot({ items: [item({ superpowers: null })] }),
    localScans: [
      {
        project: project(),
        items: [
          item({
            openspec: null,
            superpowers: {
              designSpec: null,
              plan: null,
              stage: 'designed',
              planDone: 0,
              planInProgress: 0,
              planTotal: 0
            }
          })
        ]
      }
    ],
    specCapabilities: new Map(),
    knownProjects: []
  })
  assert.deepEqual(
    merged.items[0]!.gaps.map((gap) => gap.code),
    ['openspec-only', 'superpowers-only']
  )
})

test('the gaps of an item are deduped by code', () => {
  const merged = mergeBoard({
    snapshot: snapshot({ items: [item({ superpowers: null })] }),
    localScans: [{ project: project(), items: [item({ superpowers: null })] }],
    specCapabilities: new Map(),
    knownProjects: []
  })
  assert.deepEqual(
    merged.items[0]!.gaps.map((gap) => gap.code),
    ['openspec-only']
  )
})

test("the agent's gap wins when the two sides disagree about the same code", () => {
  const superpowers = {
    designSpec: null,
    plan: 'docs/superpowers/plans/add-x.md',
    stage: 'executing' as const,
    planDone: 4,
    planInProgress: 0,
    planTotal: 4
  }
  const facts = (tasksDone: number) => ({
    changeId: 'add-x',
    stage: 'implementing' as const,
    hasProposal: true,
    hasDesign: true,
    hasTasks: true,
    tasksDone,
    tasksInProgress: 0,
    tasksTotal: 4,
    capabilities: []
  })
  const merged = mergeBoard({
    snapshot: snapshot({
      projects: [project()],
      items: [item({ openspec: facts(1), superpowers })]
    }),
    localScans: [
      { project: project(), items: [item({ openspec: facts(2), superpowers })] }
    ],
    specCapabilities: new Map(),
    knownProjects: []
  })
  const drift = merged.items[0]!.gaps.find((gap) => gap.code === 'progress-drift')
  // The agent's message wins: its numbers are the ones the card shows.
  assert.match(drift?.message ?? '', /任务 1\/4/)
  assert.equal(drift?.message.includes('2/4'), false)
})

test('the stage and the actions are the worker own derivations', () => {
  const merged = mergeBoard({
    snapshot: snapshot({ projects: [project()], items: [item()] }),
    localScans: [],
    specCapabilities: new Map(),
    knownProjects: []
  })
  assert.equal(merged.items[0]!.stage, 'implement')
  const validate = merged.items[0]!.actions.find((action) => action.id === 'openspec.validate')
  assert.deepEqual(validate?.run, { kind: 'terminal', command: 'openspec validate add-x --strict' })
})

test('a project without the CLI offers the agent form of the command', () => {
  const merged = mergeBoard({
    snapshot: snapshot({
      projects: [project({ openspecCli: { available: false } })],
      items: [item()]
    }),
    localScans: [],
    specCapabilities: new Map(),
    knownProjects: []
  })
  const validate = merged.items[0]!.actions.find((action) => action.id === 'openspec.validate')
  assert.equal(validate?.run.kind, 'agent')
})

test('an archived change of a remote project is not reported as stale', () => {
  const archived = item({
    id: 'ssh:yolo|C:/work/remote#add-x',
    projectId: 'ssh:yolo|C:/work/remote',
    openspec: {
      changeId: 'add-x',
      stage: 'archived',
      hasProposal: true,
      hasDesign: true,
      hasTasks: true,
      tasksDone: 4,
      tasksInProgress: 0,
      tasksTotal: 4,
      capabilities: ['core']
    }
  })
  const unknown = mergeBoard({
    snapshot: snapshot({ items: [archived] }),
    localScans: [],
    specCapabilities: new Map(),
    knownProjects: []
  })
  assert.equal(
    unknown.items[0]!.gaps.some((gap) => gap.code === 'archived-spec-stale'),
    false
  )

  const known = mergeBoard({
    snapshot: snapshot({ items: [archived] }),
    localScans: [],
    specCapabilities: new Map<string, string[] | undefined>([[archived.projectId, ['other']]]),
    knownProjects: []
  })
  assert.equal(
    known.items[0]!.gaps.some((gap) => gap.code === 'archived-spec-stale'),
    true
  )
})
