// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
// The 全貌 tab: the map of both frameworks, and the palette that runs their commands.
import { assert, hostError, mockHost, mount, test } from 'orca/testing'
import type { TestElement } from 'orca/testing'
import * as panel from './panel'
import { fixturePayload } from './panel-fixture'
import type { BoardPayload } from './model'
import { isRecord } from './unknown-values'

/** A host that answers the board and records what the panel asked it to run. */
function hostRecording(calls: unknown[]): ReturnType<typeof mockHost> {
  return mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'action.run': (input) => {
        calls.push(input)
        return { kind: 'terminal', terminalId: 't1' }
      }
    }
  })
}

/** The map tab, drawn against the board the fixture holds. */
async function mapTab(host: ReturnType<typeof mockHost>) {
  const view = await mount(panel, { host })
  await view.select({ label: '看板视图' }, 'map')
  return view
}

/** The pairs a correspondence row holds. */
function correspondencePairs(row: TestElement | null): { label: string; value: string }[] {
  const items = row?.props['items']
  assert.ok(Array.isArray(items))
  return items.map((item) => {
    assert.ok(isRecord(item))
    const label = item['label']
    const value = item['value']
    assert.ok(typeof label === 'string')
    assert.ok(typeof value === 'string')
    return { label, value }
  })
}

test('the map is written down, not scanned: it is there with nothing loaded', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => {
        throw hostError('timeout', '读取超时')
      }
    }
  })
  const view = await mapTab(host)
  assert.ok(view.find({ text: 'OpenSpec' }))
  assert.ok(view.find({ text: 'Superpowers' }))
  // The correspondence and the decision tree are there too.
  assert.ok(view.find({ label: '对应关系' }))
  assert.ok(view.find({ label: '修 bug：行为本就符合 spec' }))
  // Without a board there is nowhere to run a command, so there are no controls either.
  assert.equal(view.find({ type: 'Select' }), null)
  assert.equal(view.find({ type: 'Button' }), null)
  await view.unmount()
})

test('the correspondence pairs the two frameworks artifact by artifact', async () => {
  const view = await mapTab(mockHost({ requests: { 'board.get': () => fixturePayload } }))
  const rows = view.find({ label: '对应关系' })
  const pairs = correspondencePairs(rows)
  assert.deepEqual(
    pairs.map((pair) => pair.label),
    [
      'proposal.md ↔ design spec 的 Context/Goals',
      'design.md ↔ design spec 的 Decisions/Risks',
      'tasks.md ↔ plan',
      '增量 spec ↔ 验收标准'
    ]
  )
  // Every row says what it means, not only which artifacts it pairs.
  assert.ok(pairs[0]?.value.includes('两边都在回答'))
  await view.unmount()
})

test('the decision tree says when a proposal is needed', async () => {
  const view = await mapTab(mockHost({ requests: { 'board.get': () => fixturePayload } }))
  const rule = view.find({ label: '新增功能或能力' })
  assert.ok(rule)
  assert.equal(rule?.props.description, '写 proposal')
  await view.unmount()
})

test('the project picker offers the projects of the board', async () => {
  const view = await mapTab(mockHost({ requests: { 'board.get': () => fixturePayload } }))
  const picker = view.find({ label: '项目' })
  assert.deepEqual(picker?.props.options, [
    { value: 'local|/repo', label: 'repo · local' },
    { value: 'local|/legacy', label: 'legacy · local' }
  ])
  // The first project is where the commands run until another one is picked.
  assert.equal(picker?.props.value, 'local|/repo')
  await view.unmount()
})

test('the change picker offers the changes of the chosen project', async () => {
  const view = await mapTab(mockHost({ requests: { 'board.get': () => fixturePayload } }))
  const picker = view.find({ label: '变更' })
  assert.deepEqual(picker?.props.options, [
    { value: 'add-x', label: 'add-x' },
    { value: 'add-w', label: 'add-w' }
  ])
  await view.unmount()
})

test('an archived change is not offered', async () => {
  const board: BoardPayload = {
    ...fixturePayload,
    items: fixturePayload.items.map((item) =>
      item.openspec?.changeId === 'add-w'
        ? { ...item, openspec: { ...item.openspec, stage: 'archived' } }
        : item
    )
  }
  const view = await mapTab(mockHost({ requests: { 'board.get': () => board } }))
  // An archived change is not under openspec/changes/ any more, so every command that names
  // it would fail — the rule the card path applies to 归档 as well.
  assert.deepEqual(view.find({ label: '变更' })?.props.options, [
    { value: 'add-x', label: 'add-x' }
  ])
  await view.unmount()
})

test('a command that acts on a change waits for one', async () => {
  const calls: unknown[] = []
  const view = await mapTab(hostRecording(calls))
  const waiting = view.find({ type: 'Button', text: '先选一个变更' })
  assert.ok(waiting)
  assert.equal(waiting?.disabled, true)
  // A command of the project needs no change, so it is ready to press.
  assert.ok(view.find({ type: 'Button', text: '列出变更' }))
  // The disabled button does nothing at all.
  await assert.rejects(() => view.press({ type: 'Button', text: '先选一个变更' }))
  assert.deepEqual(calls, [])
  await view.unmount()
})

test('a command that acts on a change carries the change that was picked', async () => {
  const calls: unknown[] = []
  const view = await mapTab(hostRecording(calls))
  await view.select({ label: '变更' }, 'add-w')
  await view.press({ type: 'Button', text: '校验' })
  assert.deepEqual(calls, [
    { projectId: 'local|/repo', actionId: 'openspec.validate', changeId: 'add-w' }
  ])
  await view.unmount()
})

test('the panel names the action, never the command', async () => {
  const calls: unknown[] = []
  const view = await mapTab(hostRecording(calls))
  await view.select({ label: '变更' }, 'add-x')
  await view.press({ type: 'Button', text: '列出变更' })
  // The request says what to run, not how to run it.
  assert.deepEqual(calls, [{ projectId: 'local|/repo', actionId: 'openspec.list' }])
  const call = calls[0]
  assert.ok(isRecord(call))
  assert.deepEqual(Object.keys(call).sort(), ['actionId', 'projectId'])
  await view.unmount()
})

test('a command that is out is not sent again', async () => {
  const calls: unknown[] = []
  const view = await mapTab(hostRecording(calls))
  await view.select({ label: '变更' }, 'add-x')
  await view.press({ type: 'Button', text: '列出变更' })
  assert.equal(calls.length, 1)
  // The button says it is out, and pressing it again sends nothing: a second press would start
  // a second terminal, not a second attempt at the first one.
  const sent = view.find({ type: 'Button', text: '已发出' })
  assert.ok(sent)
  assert.equal(sent?.disabled, true)
  await assert.rejects(() => view.press({ type: 'Button', text: '已发出' }))
  assert.equal(calls.length, 1)
  await view.unmount()
})

test('a mutating command of the palette waits for the second press', async () => {
  const calls: unknown[] = []
  const view = await mapTab(hostRecording(calls))
  await view.select({ label: '变更' }, 'add-x')
  // Archiving a change changes it: the first press only asks.
  await view.press({ type: 'Button', text: '归档' })
  assert.deepEqual(calls, [])
  assert.ok(view.find({ type: 'Button', text: '确认执行？' }))
  await view.press({ type: 'Button', text: '确认执行？' })
  assert.deepEqual(calls, [
    { projectId: 'local|/repo', actionId: 'openspec.archive', changeId: 'add-x' }
  ])
  await view.unmount()
})

test('a change picked after the confirmation was armed is not confirmed', async () => {
  const calls: unknown[] = []
  const view = await mapTab(hostRecording(calls))
  await view.select({ label: '变更' }, 'add-x')
  await view.press({ type: 'Button', text: '归档' })
  assert.deepEqual(calls, [])
  // The change is not the one the confirmation was armed for, so the button asks again.
  await view.select({ label: '变更' }, 'add-w')
  assert.equal(view.find({ type: 'Button', text: '确认执行？' }), null)
  await view.press({ type: 'Button', text: '归档' })
  assert.deepEqual(calls, [])
  await view.press({ type: 'Button', text: '确认执行？' })
  assert.deepEqual(calls, [
    { projectId: 'local|/repo', actionId: 'openspec.archive', changeId: 'add-w' }
  ])
  await view.unmount()
})

test('a command the plugin only documents draws no button', async () => {
  const view = await mapTab(mockHost({ requests: { 'board.get': () => fixturePayload } }))
  // The two commands the catalog has no action for are still written down.
  assert.ok(view.find({ text: 'openspec list --specs' }))
  assert.ok(view.find({ text: 'openspec validate --strict' }))
  const buttons = view.findAll({ type: 'Button' })
  // Fourteen rows of the map name an action; the two that do not draw no button.
  assert.equal(buttons.length, 14)
  assert.deepEqual(
    buttons.filter((button) => !button.disabled).map((button) => button.text),
    ['列出变更', '新建提案', '设计', '写实施计划', '执行计划', '代码评审', '验证', '收尾']
  )
  // The six that act on a change wait for one.
  assert.equal(buttons.filter((button) => button.disabled).length, 6)
  await view.unmount()
})

test('the button carries the label of the action, not the label of the row', async () => {
  const view = await mapTab(mockHost({ requests: { 'board.get': () => fixturePayload } }))
  // The row says '列出进行中的变更'; the action is called '列出变更'.
  assert.ok(view.find({ text: '列出进行中的变更' }))
  assert.ok(view.find({ type: 'Button', text: '列出变更' }))
  assert.equal(view.find({ type: 'Button', text: '列出进行中的变更' }), null)
  await view.unmount()
})

test('picking another project runs the command there', async () => {
  const calls: unknown[] = []
  const view = await mapTab(hostRecording(calls))
  await view.select({ label: '项目' }, 'local|/legacy')
  await view.press({ type: 'Button', text: '列出变更' })
  assert.deepEqual(calls, [{ projectId: 'local|/legacy', actionId: 'openspec.list' }])
  // The project without the CLI: its OpenSpec commands go to an agent instead.
  assert.ok(view.find({ type: 'Badge', text: '无 CLI' }))
  await view.unmount()
})

test('a change of another project is not this project s change', async () => {
  // A board where both projects know a change of the same name.
  const board: BoardPayload = {
    ...fixturePayload,
    items: fixturePayload.items.map((item) =>
      item.openspec === null ? item : { ...item, openspec: { ...item.openspec, changeId: 'shared' } }
    )
  }
  const calls: unknown[] = []
  const host = mockHost({
    requests: {
      'board.get': () => board,
      'action.run': (input) => {
        calls.push(input)
        return { kind: 'terminal', terminalId: 't3' }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.select({ label: '看板视图' }, 'map')
  await view.select({ label: '变更' }, 'shared')
  await view.select({ label: '项目' }, 'local|/legacy')
  // The change of the other project is not this project's change.
  assert.equal(view.find({ label: '变更' })?.props.value, undefined)
  // So the command that needs one waits for a change again.
  assert.ok(view.find({ type: 'Button', text: '先选一个变更' }))
  assert.deepEqual(calls, [])
  await view.unmount()
})

test('says what the command of the palette did', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'action.run': () => ({ kind: 'agent', terminalId: 't2', agent: 'claude' })
    }
  })
  const view = await mapTab(host)
  await view.press({ type: 'Button', text: '代码评审' })
  assert.ok(view.find({ text: '已派发给 claude' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('says what the host refused when a command of the palette fails', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'action.run': () => {
        throw hostError('not_permitted', '能力未批准')
      }
    }
  })
  const view = await mapTab(host)
  await view.press({ type: 'Button', text: '列出变更' })
  assert.ok(view.find({ label: 'not_permitted' }))
  assert.ok(view.find({ text: '能力未批准' }))
  await view.unmount()
})

test('the map shows the warnings the shell carries', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => ({ ...fixturePayload, warnings: ['board.json: schemaVersion: 期望 1'] })
    }
  })
  const view = await mapTab(host)
  // A broken snapshot is not a problem of one tab: the warning sits above the tabs, so the map
  // shows it too.
  assert.ok(view.find({ text: 'board.json: schemaVersion: 期望 1' }))
  await view.unmount()
})

test('the map draws nothing Orca would drop', async () => {
  const view = await mapTab(mockHost({ requests: { 'board.get': () => fixturePayload } }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('the palette is the one the worker resolves against', async () => {
  const view = await mapTab(mockHost({ requests: { 'board.get': () => fixturePayload } }))
  // The project has the CLI, so its OpenSpec commands run in a terminal.
  assert.equal(view.find({ type: 'Button', text: '列出变更' })?.props.tooltip, '在终端里运行')
  // A skill always goes to an agent: Superpowers has no shell command.
  assert.equal(view.find({ type: 'Button', text: '代码评审' })?.props.tooltip, '交给 agent 执行')
  await view.select({ label: '项目' }, 'local|/legacy')
  // The other project has no CLI, so its OpenSpec commands go to an agent instead.
  assert.equal(view.find({ type: 'Button', text: '列出变更' })?.props.tooltip, '交给 agent 执行')
  await view.unmount()
})

test('a project whose CLI is unknown is treated as one without it', async () => {
  const board: BoardPayload = {
    ...fixturePayload,
    projects: fixturePayload.projects.map((project) =>
      project.id === 'local|/repo' ? { ...project, openspecCli: null } : project
    )
  }
  const view = await mapTab(mockHost({ requests: { 'board.get': () => board } }))
  // The worker would run the command as an agent prompt, so the button says so too.
  assert.equal(view.find({ type: 'Button', text: '列出变更' })?.props.tooltip, '交给 agent 执行')
  assert.ok(view.find({ type: 'Badge', text: '无 CLI' }))
  await view.unmount()
})

test('a change the board no longer knows is forgotten', async () => {
  let call = 0
  const host = mockHost({
    requests: {
      'board.get': () => {
        call += 1
        // The second read has no change left.
        return call === 1
          ? fixturePayload
          : {
              ...fixturePayload,
              items: fixturePayload.items.filter(
                (item) => item.openspec?.changeId !== 'add-x'
              )
            }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.select({ label: '看板视图' }, 'map')
  await view.select({ label: '变更' }, 'add-x')
  assert.ok(view.find({ type: 'Button', text: '校验' }))
  await view.post('board.changed', { agentAt: 1 })
  await view.settled()
  // The change is gone from the board, so the command that needs one waits again.
  assert.ok(view.find({ type: 'Button', text: '先选一个变更' }))
  await view.unmount()
})

test('the same command in two stages is two buttons', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'action.run': () => ({ kind: 'terminal', terminalId: 't4' })
    }
  })
  const view = await mapTab(host)
  await view.select({ label: '变更' }, 'add-x')
  // The command is written down in two stages; it is one button each.
  assert.equal(view.findAll({ type: 'Button', text: '校验' }).length, 2)
  await view.press({ type: 'Button', text: '校验' })
  // The result belongs to the button that was pressed.
  assert.equal(view.findAll({ text: '已在终端打开' }).length, 1)
  await view.unmount()
})

test('the palette of a project without a workspace is off, and it says why', async () => {
  const board: BoardPayload = {
    ...fixturePayload,
    projects: fixturePayload.projects.map((project) =>
      project.id === 'local|/repo' ? { ...project, canRun: false } : project
    )
  }
  const view = await mapTab(mockHost({ requests: { 'board.get': () => board } }))
  const button = view.find({ type: 'Button', text: '列出变更' })
  assert.equal(button?.disabled, true)
  assert.equal(button?.props.tooltip, '该项目不在 Orca workspace 里')
  // The command that acts on a change is off as well: it runs in the same project.
  await view.select({ label: '变更' }, 'add-x')
  const validate = view.find({ type: 'Button', text: '校验' })
  assert.equal(validate?.disabled, true)
  assert.equal(validate?.props.tooltip, '该项目不在 Orca workspace 里')
  await view.unmount()
})
