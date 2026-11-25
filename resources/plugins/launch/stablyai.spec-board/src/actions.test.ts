import { assert, test } from 'orca/testing'
import type { Action } from './model'
import { actionsForItem, findAction, frameworkActions } from './actions'

const item = {
  openspec: {
    changeId: 'add-x',
    stage: 'implementing' as const,
    hasProposal: true,
    hasDesign: true,
    hasTasks: true,
    tasksDone: 1,
    tasksInProgress: 0,
    tasksTotal: 2,
    capabilities: []
  },
  superpowers: {
    designSpec: 'docs/superpowers/specs/x-design.md',
    plan: 'docs/superpowers/plans/x.md',
    stage: 'executing' as const,
    planDone: 1,
    planInProgress: 0,
    planTotal: 2
  }
}

const openspecOnly = { openspec: item.openspec, superpowers: null }
const superpowersOnly = { openspec: null, superpowers: item.superpowers }

const promptOf = (action: Action): string => {
  if (action.run.kind !== 'agent') {
    throw new Error(`action ${action.id} does not run an agent prompt`)
  }
  return action.run.prompt
}

test('runs OpenSpec commands in a terminal when the CLI is there', () => {
  const actions = actionsForItem(item, true)
  const validate = findAction(actions, 'openspec.validate')!
  assert.deepEqual(validate.run, { kind: 'terminal', command: 'openspec validate add-x --strict' })
  assert.equal(validate.mutates, false)
  assert.equal(findAction(actions, 'openspec.archive')?.mutates, true)
})

test('falls back to the agent form when the host has no CLI', () => {
  const actions = actionsForItem(item, false)
  for (const action of actions.filter((a) => a.framework === 'openspec')) {
    assert.equal(action.run.kind, 'agent', action.id)
    assert.match((action.run as { prompt: string }).prompt, /openspec\/AGENTS\.md/)
  }
})

test('Superpowers actions are always dispatched to an agent', () => {
  const actions = actionsForItem(item, true)
  const plan = findAction(actions, 'superpowers.plan')!
  assert.equal(plan.run.kind, 'agent')
  assert.match((plan.run as { prompt: string }).prompt, /superpowers:writing-plans/)
  assert.equal(plan.mutates, true)
})

test('omits OpenSpec actions for an item with no change', () => {
  const actions = actionsForItem({ openspec: null, superpowers: item.superpowers }, true)
  assert.equal(actions.filter((a) => a.framework === 'openspec').length, 0)
  assert.ok(actions.length > 0)
})

test('the framework palette lists both frameworks', () => {
  const palette = frameworkActions(false)
  assert.ok(palette.openspec.length >= 4)
  assert.ok(palette.superpowers.length >= 5)
  assert.ok(palette.openspec.every((action) => action.run.kind === 'agent'))
})

test('an item offers the commands of its change and the skills of its work', () => {
  assert.deepEqual(
    actionsForItem(item, true).map((action) => action.id),
    [
      'openspec.validate',
      'openspec.show',
      'openspec.archive',
      'superpowers.brainstorm',
      'superpowers.plan',
      'superpowers.execute',
      'superpowers.review',
      'superpowers.verify'
    ]
  )
})

test('an item with only a change offers only the OpenSpec commands', () => {
  assert.deepEqual(
    actionsForItem(openspecOnly, true).map((action) => action.id),
    ['openspec.validate', 'openspec.show', 'openspec.archive']
  )
})

test('an item with only Superpowers work offers only the Superpowers skills', () => {
  assert.deepEqual(
    actionsForItem(superpowersOnly, true).map((action) => action.id),
    [
      'superpowers.brainstorm',
      'superpowers.plan',
      'superpowers.execute',
      'superpowers.review',
      'superpowers.verify'
    ]
  )
})

test('an item with neither side offers nothing', () => {
  assert.deepEqual(actionsForItem({ openspec: null, superpowers: null }, true), [])
})

test('every action carries the label, the framework and the mutates flag of its row', () => {
  assert.deepEqual(
    actionsForItem(item, true).map((action) => [
      action.id,
      action.label,
      action.framework,
      action.mutates
    ]),
    [
      ['openspec.validate', '校验', 'openspec', false],
      ['openspec.show', '看增量', 'openspec', false],
      ['openspec.archive', '归档', 'openspec', true],
      ['superpowers.brainstorm', '设计', 'superpowers', true],
      ['superpowers.plan', '写实施计划', 'superpowers', true],
      ['superpowers.execute', '执行计划', 'superpowers', true],
      ['superpowers.review', '代码评审', 'superpowers', false],
      ['superpowers.verify', '验证完成', 'superpowers', false]
    ]
  )
})

test('the OpenSpec commands are the ones the CLI actually has', () => {
  assert.deepEqual(
    actionsForItem(item, true)
      .filter((action) => action.framework === 'openspec')
      .map((action) => action.run),
    [
      { kind: 'terminal', command: 'openspec validate add-x --strict' },
      { kind: 'terminal', command: 'openspec show add-x --json --deltas-only' },
      { kind: 'terminal', command: 'openspec archive add-x --yes' }
    ]
  )
})

test("an item's commands name its own change, not the placeholder", () => {
  const actions = actionsForItem(item, true)
  assert.equal(
    actions.some((action) => JSON.stringify(action.run).includes('<change-id>')),
    false
  )
})

test('the agent fallback names the guide and the change it acts on', () => {
  const actions = actionsForItem(item, false).filter((action) => action.framework === 'openspec')
  assert.deepEqual(
    actions.map((action) => action.id),
    ['openspec.validate', 'openspec.show', 'openspec.archive']
  )
  for (const action of actions) {
    const prompt = promptOf(action)
    assert.match(prompt, /openspec\/AGENTS\.md/, action.id)
    assert.match(prompt, /add-x/, action.id)
  }
})

test('every Superpowers prompt names the skill it dispatches', () => {
  const skills: Record<string, string> = {
    'superpowers.brainstorm': 'superpowers:brainstorming',
    'superpowers.plan': 'superpowers:writing-plans',
    'superpowers.execute': 'superpowers:executing-plans',
    'superpowers.review': 'superpowers:requesting-code-review',
    'superpowers.verify': 'superpowers:verification-before-completion'
  }
  for (const action of actionsForItem(item, true).filter((a) => a.framework === 'superpowers')) {
    assert.match(promptOf(action), new RegExp(skills[action.id]!), action.id)
    assert.equal(action.run.kind, 'agent', action.id)
  }
})

test('the Superpowers prompts name the artifacts they work on', () => {
  const actions = actionsForItem(item, true)
  assert.match(
    promptOf(findAction(actions, 'superpowers.plan')!),
    /docs\/superpowers\/specs\/x-design\.md/
  )
  assert.match(
    promptOf(findAction(actions, 'superpowers.execute')!),
    /docs\/superpowers\/plans\/x\.md/
  )
})

test('a Superpowers skill with no artifact yet asks for the generic one', () => {
  const actions = actionsForItem(
    { openspec: null, superpowers: { ...item.superpowers, designSpec: null, plan: null } },
    true
  )
  assert.match(promptOf(findAction(actions, 'superpowers.plan')!), /设计 spec/)
  assert.match(promptOf(findAction(actions, 'superpowers.execute')!), /实施计划/)
})

test('the palette lists every command of both frameworks', () => {
  const palette = frameworkActions(false)
  assert.deepEqual(
    palette.openspec.map((action) => action.id),
    [
      'openspec.list',
      'openspec.validate',
      'openspec.show',
      'openspec.archive',
      'openspec.propose'
    ]
  )
  assert.deepEqual(
    palette.superpowers.map((action) => action.id),
    [
      'superpowers.brainstorm',
      'superpowers.plan',
      'superpowers.execute',
      'superpowers.review',
      'superpowers.verify'
    ]
  )
})

test('the palette runs the CLI where there is one and leaves the proposal to the agent', () => {
  const palette = frameworkActions(true)
  assert.deepEqual(
    palette.openspec.slice(0, 4).map((action) => action.run),
    [
      { kind: 'terminal', command: 'openspec list' },
      { kind: 'terminal', command: 'openspec validate <change-id> --strict' },
      { kind: 'terminal', command: 'openspec show <change-id> --json --deltas-only' },
      { kind: 'terminal', command: 'openspec archive <change-id> --yes' }
    ]
  )
  assert.equal(palette.openspec[4]!.run.kind, 'agent')
  assert.match(promptOf(palette.openspec[4]!), /openspec\/AGENTS\.md/)
})

test('the palette grades every command with the mutates flag of its row', () => {
  const palette = frameworkActions(false)
  assert.deepEqual(
    palette.openspec.map((action) => [action.id, action.mutates]),
    [
      ['openspec.list', false],
      ['openspec.validate', false],
      ['openspec.show', false],
      ['openspec.archive', true],
      ['openspec.propose', true]
    ]
  )
  assert.deepEqual(
    palette.superpowers.map((action) => [action.id, action.mutates]),
    [
      ['superpowers.brainstorm', true],
      ['superpowers.plan', true],
      ['superpowers.execute', true],
      ['superpowers.review', false],
      ['superpowers.verify', false]
    ]
  )
})

test('the palette falls back to the agent for every OpenSpec command', () => {
  const palette = frameworkActions(false)
  for (const action of palette.openspec) {
    assert.equal(action.run.kind, 'agent', action.id)
    assert.match(promptOf(action), /openspec\/AGENTS\.md/, action.id)
  }
})

test('every action id the design lists exists', () => {
  const palette = frameworkActions(false)
  assert.deepEqual(
    [...palette.openspec, ...palette.superpowers].map((action) => action.id).sort(),
    [
      'openspec.archive',
      'openspec.list',
      'openspec.propose',
      'openspec.show',
      'openspec.validate',
      'superpowers.brainstorm',
      'superpowers.execute',
      'superpowers.plan',
      'superpowers.review',
      'superpowers.verify'
    ]
  )
})

test('an unknown action id is not found', () => {
  assert.equal(findAction(actionsForItem(item, true), 'openspec.nope'), null)
  assert.equal(findAction([], 'superpowers.plan'), null)
})
