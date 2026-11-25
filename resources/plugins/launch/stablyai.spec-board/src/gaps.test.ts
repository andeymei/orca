import { assert, test } from 'orca/testing'
import type { GapCode, OpenspecFacts, SuperpowersFacts } from './model'
import { detectGaps } from './gaps'

const openspec = (over: Partial<OpenspecFacts> = {}) => ({
  changeId: 'add-x',
  stage: 'implementing' as const,
  hasProposal: true,
  hasDesign: true,
  hasTasks: true,
  tasksDone: 1,
  tasksInProgress: 0,
  tasksTotal: 4,
  capabilities: [],
  ...over
})
const superpowers = (over: Partial<SuperpowersFacts> = {}) => ({
  designSpec: 'spec.md',
  plan: 'plan.md',
  stage: 'executing' as const,
  planDone: 1,
  planInProgress: 0,
  planTotal: 4,
  ...over
})
const codes = (item: Parameters<typeof detectGaps>[0]) => detectGaps(item).map((gap) => gap.code)

test('reports a change with no Superpowers counterpart', () => {
  assert.deepEqual(codes({ openspec: openspec(), superpowers: null }), ['openspec-only'])
})

test('reports Superpowers work with no change', () => {
  assert.deepEqual(codes({ openspec: null, superpowers: superpowers() }), ['superpowers-only'])
})

test('reports drift only when both sides have started and differ by more than 0.30', () => {
  assert.ok(
    codes({
      openspec: openspec({ tasksDone: 4, tasksInProgress: 0, tasksTotal: 4 }),
      superpowers: superpowers({ planDone: 1, planInProgress: 0, planTotal: 4 })
    }).includes('progress-drift')
  )
  assert.ok(
    !codes({
      openspec: openspec({ tasksDone: 2, tasksInProgress: 0, tasksTotal: 4 }),
      superpowers: superpowers({ planDone: 2, planInProgress: 0, planTotal: 4 })
    }).includes('progress-drift')
  )
  assert.ok(
    !codes({
      openspec: openspec({ tasksDone: 0, tasksInProgress: 0, tasksTotal: 4 }),
      superpowers: superpowers({ planDone: 0, planInProgress: 0, planTotal: 4 })
    }).includes('progress-drift')
  )
})

test('reports a change with tasks but no design', () => {
  assert.ok(
    codes({ openspec: openspec({ hasDesign: false }), superpowers: superpowers() }).includes(
      'no-design'
    )
  )
})

test('reports a fully ticked change that was never archived', () => {
  assert.ok(
    codes({
      openspec: openspec({ tasksDone: 4, tasksInProgress: 0, tasksTotal: 4 }),
      superpowers: superpowers({ planDone: 4, planInProgress: 0, planTotal: 4 })
    }).includes('tasks-complete-not-archived')
  )
})

test('does not nag about an archived change that finished its tasks', () => {
  assert.ok(
    !codes({
      openspec: openspec({ stage: 'archived', tasksDone: 4, tasksInProgress: 0, tasksTotal: 4 }),
      superpowers: null
    }).includes('tasks-complete-not-archived')
  )
})

test('reports an archived change whose capability never reached specs', () => {
  assert.ok(
    codes({
      openspec: openspec({ stage: 'archived', capabilities: ['x'] }),
      superpowers: null,
      existingSpecCapabilities: []
    }).includes('archived-spec-stale')
  )
})

test('drift needs a difference of more than 0.30', () => {
  assert.ok(
    codes({
      openspec: openspec({ tasksDone: 4, tasksInProgress: 0, tasksTotal: 4 }),
      superpowers: superpowers({ planDone: 69, planInProgress: 0, planTotal: 100 })
    }).includes('progress-drift')
  )
  assert.ok(
    !codes({
      openspec: openspec({ tasksDone: 4, tasksInProgress: 0, tasksTotal: 4 }),
      superpowers: superpowers({ planDone: 71, planInProgress: 0, planTotal: 100 })
    }).includes('progress-drift')
  )
})

test('does not call a side that never started drift', () => {
  assert.ok(
    !codes({
      openspec: openspec({ tasksDone: 0, tasksInProgress: 0, tasksTotal: 4 }),
      superpowers: superpowers({ planDone: 4, planInProgress: 0, planTotal: 4 })
    }).includes('progress-drift')
  )
})

test('does not call an empty checklist drift', () => {
  assert.ok(
    !codes({
      openspec: openspec({ tasksDone: 0, tasksInProgress: 0, tasksTotal: 0 }),
      superpowers: superpowers({ planDone: 4, planInProgress: 0, planTotal: 4 })
    }).includes('progress-drift')
  )
})

test('grades every gap with the severity the spec gives it', () => {
  const severityOf = (item: Parameters<typeof detectGaps>[0], code: GapCode) =>
    detectGaps(item).find((gap) => gap.code === code)?.severity
  const change = openspec({ hasDesign: false, tasksDone: 4, tasksInProgress: 0, tasksTotal: 4 })
  const oneSided = { openspec: change, superpowers: null }
  assert.equal(severityOf(oneSided, 'openspec-only'), 'warning')
  assert.equal(severityOf({ openspec: null, superpowers: superpowers() }, 'superpowers-only'), 'warning')
  assert.equal(
    severityOf(
      { openspec: change, superpowers: superpowers({ planDone: 1, planInProgress: 0, planTotal: 4 }) },
      'progress-drift'
    ),
    'warning'
  )
  assert.equal(severityOf(oneSided, 'no-design'), 'info')
  assert.equal(severityOf(oneSided, 'tasks-complete-not-archived'), 'info')
  assert.equal(
    severityOf(
      {
        openspec: openspec({ stage: 'archived', capabilities: ['x'] }),
        superpowers: null,
        existingSpecCapabilities: []
      },
      'archived-spec-stale'
    ),
    'info'
  )
})

test('reports an archived capability that reached the specs as no gap', () => {
  assert.ok(
    !codes({
      openspec: openspec({ stage: 'archived', capabilities: ['x'] }),
      superpowers: null,
      existingSpecCapabilities: ['x']
    }).includes('archived-spec-stale')
  )
})

test('reports only the stale spec for a finished change', () => {
  assert.deepEqual(
    codes({
      openspec: openspec({ stage: 'archived', capabilities: ['x'] }),
      superpowers: null,
      existingSpecCapabilities: []
    }),
    ['archived-spec-stale']
  )
})

test('reports no gap for a finished change whose capability reached the specs', () => {
  assert.deepEqual(
    codes({
      openspec: openspec({ stage: 'archived', capabilities: ['x'] }),
      superpowers: null,
      existingSpecCapabilities: ['x']
    }),
    []
  )
})

test('reports no in-flight gap for work whose plan is done', () => {
  assert.deepEqual(
    codes({
      openspec: openspec({ hasDesign: false, tasksDone: 4, tasksInProgress: 0, tasksTotal: 4 }),
      superpowers: superpowers({ stage: 'done' })
    }),
    []
  )
})

test('says nothing about an archived capability it cannot check', () => {
  assert.deepEqual(
    codes({
      openspec: openspec({ stage: 'archived', capabilities: ['x'] }),
      superpowers: null
    }),
    []
  )
})
