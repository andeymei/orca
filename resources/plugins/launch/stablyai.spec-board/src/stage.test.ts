import { assert, test } from 'orca/testing'
import type { OpenspecFacts, SuperpowersFacts } from './model'
import { deriveStage } from './stage'

const openspec = (over: Partial<OpenspecFacts> = {}) => ({
  changeId: 'add-x',
  stage: 'proposed' as const,
  hasProposal: true,
  hasDesign: false,
  hasTasks: false,
  tasksDone: 0,
  tasksTotal: 0,
  capabilities: [],
  ...over
})
const superpowers = (over: Partial<SuperpowersFacts> = {}) => ({
  designSpec: null,
  plan: null,
  stage: 'designed' as const,
  planDone: 0,
  planTotal: 0,
  ...over
})

test('a proposal alone is the proposal stage', () => {
  assert.equal(deriveStage({ openspec: openspec(), superpowers: null }), 'proposal')
})

test('a design without tasks or a plan is the design stage', () => {
  assert.equal(
    deriveStage({ openspec: openspec({ hasDesign: true }), superpowers: superpowers() }),
    'design'
  )
})

test('tasks that nobody started are the plan stage', () => {
  assert.equal(
    deriveStage({ openspec: openspec({ hasTasks: true, tasksTotal: 4 }), superpowers: null }),
    'plan'
  )
})

test('any completed box is the implement stage', () => {
  assert.equal(
    deriveStage({
      openspec: openspec({ hasTasks: true, tasksTotal: 4, tasksDone: 1 }),
      superpowers: null
    }),
    'implement'
  )
})

test('everything ticked but not archived is validate', () => {
  assert.equal(
    deriveStage({
      openspec: openspec({ hasTasks: true, tasksTotal: 4, tasksDone: 4 }),
      superpowers: superpowers({ plan: 'p.md', planTotal: 2, planDone: 2 })
    }),
    'validate'
  )
})

test('an archived change is archive regardless of the rest', () => {
  assert.equal(
    deriveStage({
      openspec: openspec({ stage: 'archived', hasTasks: true, tasksTotal: 1, tasksDone: 1 }),
      superpowers: null
    }),
    'archive'
  )
})

test('Superpowers work with no change still gets a stage', () => {
  assert.equal(
    deriveStage({ openspec: null, superpowers: superpowers({ designSpec: 's.md' }) }),
    'design'
  )
  assert.equal(
    deriveStage({ openspec: null, superpowers: superpowers({ plan: 'p.md', planTotal: 3 }) }),
    'plan'
  )
})
