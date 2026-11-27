// Which button a card leads with. The stage says what the work is waiting for, and the leading
// button has to be the step that moves it on — for a card that carries only one of the two
// frameworks too.
import { assert, test } from 'orca/testing'
import type { Action, OpenspecFacts, UnifiedStage, WorkItem } from './model'
import { archiveReady, otherActions, primaryAction } from './panel-primary-action'

function action(id: string): Action {
  return {
    id,
    label: id,
    framework: id.startsWith('openspec.') ? 'openspec' : 'superpowers',
    run: { kind: 'agent', prompt: id },
    mutates: true,
    scope: 'change'
  }
}

function item(stage: UnifiedStage, ids: readonly string[]): WorkItem {
  return {
    id: 'local|/repo#add-x',
    projectId: 'local|/repo',
    title: 'Add X',
    topic: 'add-x',
    stage,
    openspec: null,
    superpowers: null,
    gaps: [],
    actions: ids.map(action),
    sources: []
  }
}

/** A change whose tasks are all ticked, waiting to be archived. */
function readyToArchive(): WorkItem {
  const facts: OpenspecFacts = {
    changeId: 'add-x',
    stage: 'validated',
    hasProposal: true,
    hasDesign: true,
    hasTasks: true,
    tasksDone: 3,
    tasksInProgress: 0,
    tasksTotal: 3,
    capabilities: []
  }
  return {
    ...item('validate', ['openspec.validate', 'openspec.archive']),
    openspec: facts
  }
}

test('the proposal stage writes the design', () => {
  const card = item('proposal', ['superpowers.brainstorm', 'superpowers.plan'])
  assert.equal(primaryAction(card)?.id, 'superpowers.brainstorm')
})

test('the design stage writes the plan, not the design again', () => {
  // The design is what the stage is about: writing it again does not move the work on.
  const card = item('design', ['superpowers.brainstorm', 'superpowers.plan'])
  assert.equal(primaryAction(card)?.id, 'superpowers.plan')
})

test('the plan and implement stages run the plan', () => {
  assert.equal(primaryAction(item('plan', ['superpowers.plan', 'superpowers.execute']))?.id, 'superpowers.execute')
  assert.equal(
    primaryAction(item('implement', ['superpowers.plan', 'superpowers.execute']))?.id,
    'superpowers.execute'
  )
})

test('the validate stage checks the work', () => {
  const card = item('validate', ['openspec.validate', 'superpowers.verify'])
  assert.equal(primaryAction(card)?.id, 'openspec.validate')
})

test('a change of its own leads with its own step', () => {
  // A card with no Superpowers side has no design to write and no plan to run: the step that
  // moves it on is the one that fills the change in.
  assert.equal(
    primaryAction(item('proposal', ['openspec.validate', 'openspec.complete']))?.id,
    'openspec.complete'
  )
  assert.equal(
    primaryAction(item('implement', ['openspec.validate', 'openspec.implement']))?.id,
    'openspec.implement'
  )
})

test('a card with no action of its own leads with nothing', () => {
  assert.equal(primaryAction(item('proposal', [])), null)
  assert.deepEqual(otherActions(item('proposal', [])), [])
})

test('the other actions stay behind 更多', () => {
  const card = item('design', ['superpowers.brainstorm', 'superpowers.plan', 'superpowers.execute'])
  assert.equal(primaryAction(card)?.id, 'superpowers.plan')
  assert.deepEqual(
    otherActions(card).map((entry) => entry.id),
    ['superpowers.brainstorm', 'superpowers.execute']
  )
})

test('a change whose tasks are all ticked leads with the archive', () => {
  // Archiving is the step that moves the change on; the check before it does not.
  const card = readyToArchive()
  assert.equal(archiveReady(card), true)
  assert.equal(primaryAction(card)?.id, 'openspec.archive')
  // The check stays behind 更多, where it can still be run.
  assert.deepEqual(
    otherActions(card).map((entry) => entry.id),
    ['openspec.validate']
  )
})

test('a change that is still being worked on does not lead with the archive', () => {
  const card: WorkItem = { ...readyToArchive(), stage: 'implement' }
  assert.equal(archiveReady(card), false)
  assert.equal(primaryAction(card)?.id, 'openspec.validate')
})

test('a change whose tasks are not all ticked does not lead with the archive', () => {
  const card = readyToArchive()
  const facts = { ...card.openspec!, stage: 'implementing' as const }
  const working = { ...card, openspec: facts }
  assert.equal(archiveReady(working), false)
  assert.equal(primaryAction(working)?.id, 'openspec.validate')
})
