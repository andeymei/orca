import { assert, test } from 'orca/testing'
import { parseBoardSnapshot } from './board-schema'

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
        tasksTotal: 5,
        capabilities: ['x']
      },
      superpowers: null
    }
  ]
}

test('accepts a minimal valid snapshot', () => {
  const result = parseBoardSnapshot(valid)
  assert.equal(result.ok, true)
})

test('rejects an unknown schemaVersion', () => {
  const result = parseBoardSnapshot({ ...valid, schemaVersion: 2 })
  assert.equal(result.ok, false)
  assert.match((result as { error: string }).error, /schemaVersion/)
})

test('rejects progress where done exceeds total', () => {
  const item = {
    ...valid.items[0],
    openspec: { ...valid.items[0]!.openspec, tasksDone: 9, tasksTotal: 5 }
  }
  const result = parseBoardSnapshot({ ...valid, items: [item] })
  assert.equal(result.ok, false)
  assert.match((result as { error: string }).error, /tasksDone/)
})

test('rejects a project without a path', () => {
  const project = { ...valid.projects[0] } as Record<string, unknown>
  delete project.path
  const result = parseBoardSnapshot({ ...valid, projects: [project] })
  assert.equal(result.ok, false)
  assert.match((result as { error: string }).error, /path/)
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
