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
  tasksInProgress: 0,
  tasksTotal: 0,
  capabilities: [],
  ...over
})
const superpowers = (over: Partial<SuperpowersFacts> = {}) => ({
  designSpec: null,
  plan: null,
  stage: 'designed' as const,
  planDone: 0,
  planInProgress: 0,
  planTotal: 0,
  verification: null,
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

test('an in-progress box means the work has started, but it is not finished', () => {
  assert.equal(
    deriveStage({
      openspec: null,
      superpowers: superpowers({ plan: 'p.md', planDone: 0, planInProgress: 2, planTotal: 5 })
    }),
    'implement'
  )
  assert.equal(
    deriveStage({
      openspec: openspec({ hasTasks: true, tasksDone: 4, tasksInProgress: 1, tasksTotal: 5 }),
      superpowers: null
    }),
    'implement'
  )
})

test('an empty checklist does not veto a fully ticked plan', () => {
  assert.equal(
    deriveStage({
      openspec: openspec({ hasTasks: true, tasksDone: 0, tasksTotal: 0 }),
      superpowers: superpowers({ plan: 'p.md', planDone: 5, planTotal: 5 })
    }),
    'validate'
  )
})

test('empty checklists on both sides are the plan stage, not validate', () => {
  assert.equal(
    deriveStage({
      openspec: openspec({ hasTasks: true, tasksDone: 0, tasksTotal: 0 }),
      superpowers: superpowers({ plan: 'p.md', planDone: 0, planTotal: 0 })
    }),
    'plan'
  )
  assert.equal(
    deriveStage({
      openspec: openspec({ hasTasks: true, tasksDone: 0, tasksTotal: 0 }),
      superpowers: null
    }),
    'plan'
  )
})

test('清单全勾且最近一轮通过，就是「已验证」', () => {
  assert.equal(
    deriveStage({
      openspec: null,
      superpowers: superpowers({
        plan: 'p.md',
        planTotal: 2,
        planDone: 2,
        verification: { rounds: 2, passed: 1, lastPassed: true }
      })
    }),
    'verified'
  )
})

test('最近一轮没过，就还留在「校验」', () => {
  assert.equal(
    deriveStage({
      openspec: null,
      superpowers: superpowers({
        plan: 'p.md',
        planTotal: 2,
        planDone: 2,
        verification: { rounds: 2, passed: 1, lastPassed: false }
      })
    }),
    'validate'
  )
})

test('没有记录就还是「校验」', () => {
  // 旧行为不变：没有证据就没有「已验证」。
  assert.equal(
    deriveStage({
      openspec: null,
      superpowers: superpowers({ plan: 'p.md', planTotal: 2, planDone: 2 })
    }),
    'validate'
  )
})

test('验证过了又加了新任务，就退回「实现」', () => {
  // 阶段机先看清单：清单没勾完就不是验证过。
  assert.equal(
    deriveStage({
      openspec: null,
      superpowers: superpowers({
        plan: 'p.md',
        planTotal: 3,
        planDone: 2,
        verification: { rounds: 1, passed: 1, lastPassed: true }
      })
    }),
    'implement'
  )
})

test('只有 OpenSpec 一侧的工作项永远不会「已验证」', () => {
  // 记录写在计划文件里；没有计划就没有地方写，也就没有证据。
  assert.equal(
    deriveStage({
      openspec: openspec({ hasTasks: true, tasksTotal: 4, tasksDone: 4 }),
      superpowers: null
    }),
    'validate'
  )
})
