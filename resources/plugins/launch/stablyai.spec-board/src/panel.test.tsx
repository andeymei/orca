// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, hostError, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import { fixturePayload } from './panel-fixture'

test('draws the change, both progress lanes and its gaps', async () => {
  const host = mockHost({ requests: { 'board.get': () => fixturePayload } })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: 'Add X' }))
  assert.ok(view.find({ text: 'repo · local' }))
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
  assert.ok(view.find({ text: 'local|/repo' }))
  await view.unmount()
})

test('counts the work in every stage and marks the stage the rail is on', async () => {
  const host = mockHost({ requests: { 'board.get': () => fixturePayload } })
  const view = await mount(panel, { host })
  const selected = view.find({ type: 'Button', text: '实现 3' })
  assert.ok(selected)
  assert.equal(selected?.props.variant, 'solid')
  const other = view.find({ type: 'Button', text: '提案 0' })
  assert.ok(other)
  assert.equal(other?.props.variant, 'ghost')
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
        return { kind: 'terminal', terminalId: 't2' }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: '归档' })
  assert.deepEqual(calls, [])
  await view.press({ text: '确认执行？' })
  assert.deepEqual(calls, [
    { projectId: 'local|/repo', actionId: 'openspec.archive', itemId: 'local|/repo#add-x' }
  ])
  await view.unmount()
})

test('holds a second mutating action until its own second press', async () => {
  const calls: unknown[] = []
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'action.run': (input) => {
        calls.push(input)
        return { kind: 'agent', terminalId: 't3' }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: '归档' })
  await view.press({ text: '执行计划' })
  // A mutating action never runs on the first press, not even while another one is waiting.
  assert.deepEqual(calls, [])
  assert.ok(view.find({ text: '确认执行？' }))
  assert.ok(view.find({ text: '归档' }))
  await view.unmount()
})

test('the confirmation expires', async () => {
  const calls: unknown[] = []
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'action.run': (input) => {
        calls.push(input)
        return { kind: 'terminal', terminalId: 't4' }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: '归档' })
  assert.ok(view.find({ text: '确认执行？' }))
  // The window is three seconds; after it the button asks again.
  const deadline = Date.now() + 5000
  while (view.find({ text: '归档' }) === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    await view.settled()
  }
  assert.ok(view.find({ text: '归档' }))
  await view.press({ text: '归档' })
  assert.deepEqual(calls, [])
  await view.unmount()
})

test('says when the stage has no work', async () => {
  const host = mockHost({ requests: { 'board.get': () => fixturePayload } })
  const view = await mount(panel, { host })
  await view.press({ type: 'Button', text: '提案 0' })
  assert.ok(view.find({ type: 'EmptyState' }))
  assert.equal(view.find({ text: 'Add X' }), null)
  await view.unmount()
})

test('shows the warnings the worker recorded', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => ({ ...fixturePayload, warnings: ['board.json: schemaVersion: 期望 1'] })
    }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: 'board.json: schemaVersion: 期望 1' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('shows what the host refused when the board cannot be read', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => {
        throw hostError('timeout', '读取超时')
      }
    }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ label: 'timeout' }))
  assert.ok(view.find({ text: '读取超时' }))
  assert.ok(view.find({ text: '还没有读到看板。' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('reads the board again when the worker says it changed', async () => {
  let reads = 0
  const host = mockHost({
    requests: {
      'board.get': () => {
        reads += 1
        return fixturePayload
      }
    }
  })
  const view = await mount(panel, { host })
  assert.equal(reads, 1)

  await view.post('board.changed', { agentAt: 1 })
  assert.equal(reads, 2)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('the other two tabs are there', async () => {
  const host = mockHost({ requests: { 'board.get': () => fixturePayload } })
  const view = await mount(panel, { host })
  assert.ok(view.find({ type: 'Tabs' }))
  await view.select({ type: 'Tabs' }, 'map')
  assert.ok(view.find({ text: '这个标签页由后面的任务完成' }))
  assert.equal(view.find({ text: 'Add X' }), null)
  await view.unmount()
})
