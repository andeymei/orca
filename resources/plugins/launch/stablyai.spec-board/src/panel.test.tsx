// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
// The shell and the board tab: the stage rail, the reads, and the three tabs.
import { assert, hostError, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import { fixturePayload } from './panel-fixture'
import type { BoardPayload } from './model'

/** The board as it looked a moment ago: the first card has another name. */
function boardTitled(title: string): BoardPayload {
  return {
    ...fixturePayload,
    items: fixturePayload.items.map((item, index) =>
      index === 0 ? { ...item, title } : item
    )
  }
}

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

test('an older read does not overwrite a newer board', async () => {
  const titles = ['First board', 'Stale board', 'Fresh board']
  let call = 0
  const host = mockHost({
    requests: {
      'board.get': () => {
        call += 1
        const title = titles[call - 1]
        // The second read answers last, and its answer is the older one.
        const delay = call === 2 ? 40 : 0
        return new Promise((resolve) => {
          setTimeout(() => resolve(boardTitled(title)), delay)
        })
      }
    }
  })
  const view = await mount(panel, { host })
  const first = view.post('board.changed', { agentAt: 1 })
  const second = view.post('board.changed', { agentAt: 2 })
  await Promise.all([first, second])
  await view.settled()
  assert.ok(view.find({ text: 'Fresh board' }))
  assert.equal(view.find({ text: 'Stale board' }), null)
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
