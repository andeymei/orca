// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
// One card of the board: what it says, which button it leads with, and what its buttons do.
import { assert, hostError, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import { fixturePayload } from './panel-fixture'
import type { BoardPayload } from './model'

test('draws the change, both progress lanes and its gaps', async () => {
  const host = mockHost({ requests: { 'board.get': () => fixturePayload } })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: 'Add X' }))
  assert.ok(view.find({ type: 'Badge', text: 'repo · local' }))
  assert.ok(view.find({ text: 'OpenSpec 2/5' }))
  assert.ok(view.find({ text: 'Superpowers 1/8' }))
  assert.ok(view.find({ text: '有 OpenSpec 变更，没有对应的 Superpowers 设计' }))
  // The bar takes a percentage, not a fraction: two of five tasks is forty.
  assert.equal(view.find({ type: 'Progress', label: 'OpenSpec 任务进度' })?.props.value, 40)
  assert.equal(view.find({ type: 'Progress', label: 'Superpowers 计划进度' })?.props.value, 13)
  assert.equal(
    view.find({ text: '有 OpenSpec 变更，没有对应的 Superpowers 设计' })?.props.tone,
    'warning'
  )
  assert.equal(view.find({ text: '有 tasks.md，但缺少 design.md' })?.props.tone, 'neutral')
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('names the project the work belongs to', async () => {
  const host = mockHost({
    requests: { 'board.get': () => ({ ...fixturePayload, projects: [] }) }
  })
  const view = await mount(panel, { host })
  // The board does not know the project: the card still says which project it is.
  assert.ok(view.find({ type: 'Badge', text: 'local|/repo' }))
  await view.unmount()
})

test('marks only the card whose OpenSpec action runs no command', async () => {
  const host = mockHost({ requests: { 'board.get': () => fixturePayload } })
  const view = await mount(panel, { host })
  // Three cards are on the rail's stage; only the one in the project without the CLI wears it.
  assert.equal(view.findAll({ type: 'Card' }).length, 3)
  assert.equal(view.findAll({ text: '无 CLI' }).length, 1)
  await view.unmount()
})

test('leads with the action the stage waits for', async () => {
  const host = mockHost({ requests: { 'board.get': () => fixturePayload } })
  const view = await mount(panel, { host })
  // Add Z is in the implement stage, which waits for the plan to be executed.
  const preferred = view.find({ type: 'Button', text: '执行计划' })
  assert.ok(preferred)
  assert.equal(preferred?.props.variant, 'solid')
  // Add X has no Superpowers skill, so its card falls back to the first action it offers.
  const fallback = view.find({ type: 'Button', text: '校验' })
  assert.ok(fallback)
  assert.equal(fallback?.props.variant, 'solid')
  // The other action is behind 更多, so it is not on the card yet.
  assert.equal(view.find({ type: 'Button', text: '代码评审' }), null)
  await view.unmount()
})

test('the other actions are behind 更多', async () => {
  const host = mockHost({ requests: { 'board.get': () => fixturePayload } })
  const view = await mount(panel, { host })
  assert.equal(view.find({ type: 'Button', text: '归档' }), null)
  // Only the two cards that offer more than one action carry a 更多.
  assert.equal(view.findAll({ type: 'Collapsible' }).length, 2)
  await view.toggle({ label: '更多' })
  const other = view.find({ type: 'Button', text: '归档' })
  assert.ok(other)
  assert.equal(other?.props.variant, 'outline')
  await view.unmount()
})

test('runs a non-mutating action on the first press', async () => {
  const calls: unknown[] = []
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'action.run': (input) => {
        calls.push(input)
        return { kind: 'terminal', terminalId: 't1' }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: '校验' })
  assert.deepEqual(calls, [
    { projectId: 'local|/repo', actionId: 'openspec.validate', itemId: 'local|/repo#add-x' }
  ])
  await view.unmount()
})

test('holds a mutating action until a second press', async () => {
  const calls: unknown[] = []
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'action.run': (input) => {
        calls.push(input)
        return { kind: 'agent', terminalId: 't2' }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: '执行计划' })
  assert.deepEqual(calls, [])
  await view.press({ text: '确认执行？' })
  assert.deepEqual(calls, [
    { projectId: 'local|/repo', actionId: 'superpowers.execute', itemId: 'local|/repo#add-z' }
  ])
  await view.unmount()
})

test('holds a mutating action behind 更多 until a second press', async () => {
  const calls: unknown[] = []
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'action.run': (input) => {
        calls.push(input)
        return { kind: 'terminal', terminalId: 't3' }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.toggle({ label: '更多' })
  await view.press({ text: '归档' })
  assert.deepEqual(calls, [])
  await view.press({ text: '确认执行？' })
  assert.deepEqual(calls, [
    { projectId: 'local|/repo', actionId: 'openspec.archive', itemId: 'local|/repo#add-x' }
  ])
  await view.unmount()
})

test('a mutating action never runs while another one is waiting', async () => {
  const calls: unknown[] = []
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'action.run': (input) => {
        calls.push(input)
        return { kind: 'terminal', terminalId: 't7' }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.toggle({ label: '更多' })
  await view.press({ text: '执行计划' })
  await view.press({ text: '归档' })
  // The second action asks for its own confirmation: the first one's answer is not its answer.
  assert.deepEqual(calls, [])
  assert.ok(view.find({ text: '确认执行？' }))
  await view.unmount()
})

test('says what the action did', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'action.run': () => ({ kind: 'terminal', terminalId: 't4' })
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: '校验' })
  assert.ok(view.find({ text: '已在终端打开' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('says when the action went to an agent', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'action.run': () => ({ kind: 'agent', terminalId: 't5', agent: 'claude' })
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: '看增量' })
  assert.ok(view.find({ text: '已派发给 claude' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('says that an agent took the action when the worker names none', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'action.run': () => ({ kind: 'agent', terminalId: 't5' })
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: '看增量' })
  assert.ok(view.find({ text: '已派发给 agent' }))
  await view.unmount()
})

test('shows what the host refused when an action fails', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'action.run': () => {
        throw hostError('not_permitted', '能力未批准')
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: '校验' })
  assert.ok(view.find({ label: 'not_permitted' }))
  assert.ok(view.find({ text: '能力未批准' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a later action clears the failure of the last one', async () => {
  let refused = true
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'action.run': () => {
        if (refused) {
          throw hostError('not_permitted', '能力未批准')
        }
        return { kind: 'agent', terminalId: 't6' }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: '校验' })
  assert.ok(view.find({ text: '能力未批准' }))
  refused = false
  await view.press({ text: '看增量' })
  assert.equal(view.find({ text: '能力未批准' }), null)
  await view.unmount()
})

test('the next action is a hint, not a button', async () => {
  const host = mockHost({ requests: { 'board.get': () => fixturePayload } })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: '写下设计' }))
  assert.ok(view.find({ text: '先写设计 spec，再改代码' }))
  assert.equal(view.find({ type: 'Button', text: '写下设计' }), null)
  await view.unmount()
})

test('the actions of a project without a workspace are off, and they say why', async () => {
  const calls: unknown[] = []
  const board: BoardPayload = {
    ...fixturePayload,
    projects: fixturePayload.projects.map((project) =>
      project.id === 'local|/repo' ? { ...project, hasWorkspace: false } : project
    )
  }
  const host = mockHost({
    requests: {
      'board.get': () => board,
      'action.run': (input) => {
        calls.push(input)
        return { kind: 'terminal', terminalId: 't8' }
      }
    }
  })
  const view = await mount(panel, { host })
  const button = view.find({ type: 'Button', text: '校验' })
  assert.equal(button?.disabled, true)
  assert.equal(button?.props.tooltip, '该项目不在 Orca workspace 里')
  // The button is the notice: nothing runs.
  await assert.rejects(() => view.press({ type: 'Button', text: '校验' }))
  assert.deepEqual(calls, [])
  // The other project still has a workspace, so its card still works.
  assert.equal(view.find({ type: 'Button', text: '看增量' })?.disabled, false)
  await view.unmount()
})
