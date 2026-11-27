// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
// The board tab: the stage rail, the cards of the stage it is on, and the refresh that puts the
// board back in step with the files.
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import { fixturePayload } from './panel-fixture'
import type { BoardPayload } from './model'

test('the board refreshes the project it is showing', async () => {
  const calls: unknown[] = []
  const board: BoardPayload = {
    ...fixturePayload,
    focus: {
      projectId: 'local|/repo',
      workspaceId: 'w1',
      host: 'local',
      path: '/repo'
    }
  }
  const host = mockHost({
    requests: {
      'board.get': () => board,
      'board.refreshProject': (input) => {
        calls.push(input)
        return { kind: 'local' }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ type: 'Button', text: '刷新' })
  // The project on screen is the one that is refreshed: the rest are nobody's business here.
  assert.deepEqual(calls, [{ projectId: 'local|/repo' }])
  await view.unmount()
})

test('a board with no focused project refreshes everything', async () => {
  const calls: unknown[] = []
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'board.refresh': () => {
        calls.push('refresh')
        return { terminalId: 't1', agent: 'claude' }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ type: 'Button', text: '刷新' })
  assert.deepEqual(calls, ['refresh'])
  await view.unmount()
})
