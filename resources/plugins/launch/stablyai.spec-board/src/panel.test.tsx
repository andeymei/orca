// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import type { BoardPayload } from './model'

const payload: BoardPayload = {
  items: [
    {
      id: 'local|/repo/demo#add-x',
      projectId: 'local|/repo/demo',
      title: '新增 X',
      topic: 'add-x',
      openspec: null,
      superpowers: null,
      stage: 'proposal',
      gaps: [],
      actions: []
    }
  ],
  projects: [],
  sources: { localAt: null, agentAt: null },
  warnings: ['快照不是合法的 JSON：/tmp/board.json']
}

test('draws what the worker answered with', async () => {
  // Stands in for src/worker.ts: what each plugin.request answers.
  const host = mockHost({ requests: { 'board.get': () => payload } })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: '新增 X' }))
  assert.ok(view.find({ text: '快照不是合法的 JSON：/tmp/board.json' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('reads the board again when the worker says it changed', async () => {
  let reads = 0
  const host = mockHost({
    requests: {
      'board.get': () => {
        reads += 1
        return payload
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
