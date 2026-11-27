// The merge of one project's facts into the board's snapshot: the other projects are not touched,
// and what wins is what was collected last.
import { assert, test } from 'orca/testing'
import { applyProjectFacts, factsOf, scannedAtOf, supersedes } from './snapshot-merge'
import type { BoardSnapshot, SnapshotItem, SnapshotProject } from './model'

/** A project as the snapshot holds it. */
function project(id: string, scannedAt: string): SnapshotProject {
  return {
    id,
    name: id,
    host: 'local',
    path: '/repo',
    openspec: { present: true, capabilities: [], activeChanges: 1, archived: 0 },
    superpowers: null,
    openspecCli: { available: true, version: '1.8.0' },
    scannedAt
  }
}

/** One work item of one project. */
function item(projectId: string, topic: string): SnapshotItem {
  return {
    id: `${projectId}#${topic}`,
    projectId,
    title: topic,
    topic,
    openspec: null,
    superpowers: null
  }
}

/** The board's snapshot, with two projects in it. */
function snapshot(): BoardSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: '2026-11-25T10:00:00.000Z',
    generatedBy: { agent: 'claude' },
    projects: [
      project('local|/a', '2026-11-25T10:00:00.000Z'),
      project('local|/b', '2026-11-25T10:00:00.000Z')
    ],
    items: [item('local|/a', 'add-x'), item('local|/b', 'add-y')]
  }
}

test('the merge replaces one project and its items, and leaves the others alone', () => {
  const merged = applyProjectFacts(snapshot(), {
    project: { ...project('local|/a', '2026-11-27T10:00:00.000Z'), name: 'a' },
    items: [item('local|/a', 'add-z')]
  })
  assert.equal(merged.projects.length, 2)
  const a = merged.projects.find((entry) => entry.id === 'local|/a')
  assert.equal(a?.scannedAt, '2026-11-27T10:00:00.000Z')
  // The other project is not this merge's business.
  const b = merged.projects.find((entry) => entry.id === 'local|/b')
  assert.equal(b?.scannedAt, '2026-11-25T10:00:00.000Z')
  // The work items of the project that was merged are its own now.
  assert.deepEqual(
    merged.items.map((entry) => entry.id),
    ['local|/a#add-z', 'local|/b#add-y']
  )
})

test('the merge keeps the CLI answer a scan has none of', () => {
  const merged = applyProjectFacts(snapshot(), {
    project: { ...project('local|/a', '2026-11-27T10:00:00.000Z'), openspecCli: null },
    items: []
  })
  // A local scan says what the project holds, not whether the CLI is installed there.
  const a = merged.projects.find((entry) => entry.id === 'local|/a')
  assert.equal(a?.openspecCli?.available, true)
  assert.equal(a?.openspecCli?.version, '1.8.0')
})

test('the facts of a project are the ones that belong to it', () => {
  const facts = factsOf(snapshot(), 'local|/b')
  assert.equal(facts?.project.id, 'local|/b')
  assert.deepEqual(
    facts?.items.map((entry) => entry.id),
    ['local|/b#add-y']
  )
  assert.equal(factsOf(snapshot(), 'local|/nowhere'), null)
})

test('the facts win by when they were collected, not by when the file was written', () => {
  // The plugin writes the board's snapshot itself whenever it merges something into it, so the
  // file's time says when the file was touched, not when the project was collected.
  assert.equal(supersedes(200, 100), true)
  assert.equal(supersedes(100, 200), false)
  // A time nobody can read is no evidence: the new facts win.
  assert.equal(supersedes(null, 100), true)
  assert.equal(supersedes(100, null), true)
})

test('a project that names no time gives no time', () => {
  assert.equal(scannedAtOf(project('local|/a', '2026-11-25T10:00:00.000Z')), 1795600800000)
  // A time without a zone is read as UTC: the snapshot is written by an agent, on a machine whose
  // zone is not the reader's.
  assert.equal(scannedAtOf(project('local|/a', '2026-11-25T10:00:00')), 1795600800000)
  assert.equal(scannedAtOf(project('local|/a', '')), null)
  assert.equal(scannedAtOf(project('local|/a', 'not-a-time')), null)
})
