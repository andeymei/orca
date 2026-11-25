import { assert, test } from 'orca/testing'
import { parseBoardSnapshot } from './board-schema'
import type { ParseResult } from './board-schema'

const valid = {
  schemaVersion: 1,
  generatedAt: '2026-11-25T10:00:00.000Z',
  generatedBy: { agent: 'claude' },
  projects: [
    {
      id: 'local|/repo',
      name: 'repo',
      host: 'local',
      path: '/repo',
      openspec: null,
      superpowers: null,
      openspecCli: null,
      scannedAt: '2026-11-25T10:00:00.000Z'
    }
  ],
  items: [
    {
      id: 'local|/repo#add-x',
      projectId: 'local|/repo',
      title: 'Add X',
      topic: 'add-x',
      openspec: {
        changeId: 'add-x',
        stage: 'implementing',
        hasProposal: true,
        hasDesign: false,
        hasTasks: true,
        tasksDone: 2,
        tasksInProgress: 0,
        tasksTotal: 5,
        capabilities: ['x']
      },
      superpowers: null
    }
  ]
}

/** Parses without letting the validator's error log reach the test output. */
function parseSilently(raw: unknown): { result: ParseResult; logged: unknown[][] } {
  const logged: unknown[][] = []
  const original = console.error
  console.error = (...args: unknown[]) => {
    logged.push(args)
  }
  try {
    return { result: parseBoardSnapshot(raw), logged }
  } finally {
    console.error = original
  }
}

test('accepts a minimal valid snapshot', () => {
  const result = parseBoardSnapshot(valid)
  assert.equal(result.ok, true)
})

test('rejects an unknown schemaVersion', () => {
  const result = parseBoardSnapshot({ ...valid, schemaVersion: 2 })
  assert.equal(result.ok, false)
  if (result.ok) {
    return
  }
  assert.match(result.error, /schemaVersion/)
})

test('rejects progress where done exceeds total', () => {
  const item = {
    ...valid.items[0],
    openspec: { ...valid.items[0]!.openspec, tasksDone: 9, tasksTotal: 5 }
  }
  const result = parseBoardSnapshot({ ...valid, items: [item] })
  assert.equal(result.ok, false)
  if (result.ok) {
    return
  }
  assert.match(result.error, /\.tasksDone:/)
})

test('rejects progress where done plus in-progress exceeds total', () => {
  const item = {
    ...valid.items[0],
    openspec: { ...valid.items[0]!.openspec, tasksDone: 2, tasksInProgress: 4, tasksTotal: 5 }
  }
  const result = parseBoardSnapshot({ ...valid, items: [item] })
  assert.equal(result.ok, false)
  if (result.ok) {
    return
  }
  assert.match(result.error, /\.tasksInProgress:/)
})

test('rejects a plan whose in-progress boxes exceed its total', () => {
  const item = {
    ...valid.items[0],
    superpowers: {
      designSpec: null,
      plan: 'docs/superpowers/plans/2026-11-25-add-x.md',
      stage: 'executing',
      planDone: 1,
      planInProgress: 3,
      planTotal: 3
    }
  }
  const result = parseBoardSnapshot({ ...valid, items: [item] })
  assert.equal(result.ok, false)
  if (result.ok) {
    return
  }
  assert.match(result.error, /\.planInProgress:/)
})

test('accepts progress where done plus in-progress fills the total', () => {
  const item = {
    ...valid.items[0],
    openspec: { ...valid.items[0]!.openspec, tasksDone: 2, tasksInProgress: 3, tasksTotal: 5 }
  }
  const result = parseBoardSnapshot({ ...valid, items: [item] })
  assert.equal(result.ok, true)
})

test('rejects a project without a path', () => {
  const project: Record<string, unknown> = { ...valid.projects[0] }
  delete project.path
  const result = parseBoardSnapshot({ ...valid, projects: [project] })
  assert.equal(result.ok, false)
  if (result.ok) {
    return
  }
  assert.match(result.error, /path/)
})

test('keeps a missing generatedAt parseable so the panel can say it is unknown', () => {
  const { generatedAt: _generatedAt, ...rest } = valid
  const result = parseBoardSnapshot(rest)
  assert.equal(result.ok, true)
  assert.equal(result.ok === true ? result.value.generatedAt : '', '')
})

test('reads null as absent for the optional fields but keeps a null framework', () => {
  const result = parseBoardSnapshot({
    ...valid,
    projects: [
      {
        ...valid.projects[0],
        openspecCli: { available: true, version: null, path: null },
        error: null
      }
    ],
    items: [{ ...valid.items[0], summary: null, nextAction: null }]
  })
  assert.equal(result.ok, true)
  if (!result.ok) {
    return
  }
  const project = result.value.projects[0]!
  const item = result.value.items[0]!
  assert.equal('error' in project, false)
  assert.equal('version' in project.openspecCli!, false)
  assert.equal('path' in project.openspecCli!, false)
  assert.equal('summary' in item, false)
  assert.equal('nextAction' in item, false)
  assert.equal(item.superpowers, null)
})

test('reads notes: null as absent', () => {
  const result = parseBoardSnapshot({ ...valid, notes: null })
  assert.equal(result.ok, true)
  if (!result.ok) {
    return
  }
  assert.equal('notes' in result.value, false)
})

test('keeps a validator failure out of the user-facing message', () => {
  const { result, logged } = parseSilently({
    ...valid,
    get projects(): unknown {
      throw new TypeError("Cannot read properties of undefined (reading 'x')")
    }
  })
  assert.equal(result.ok, false)
  if (result.ok) {
    return
  }
  assert.equal(result.error.includes('Cannot read properties'), false)
  assert.equal(
    logged.flat().some((entry) => String(entry).includes('TypeError')),
    true
  )
})

test('still names the offending field for a malformed snapshot', () => {
  const item: Record<string, unknown> = { ...valid.items[0] }
  delete item.projectId
  const result = parseBoardSnapshot({ ...valid, items: [item] })
  assert.equal(result.ok, false)
  if (result.ok) {
    return
  }
  assert.match(result.error, /projectId/)
})
