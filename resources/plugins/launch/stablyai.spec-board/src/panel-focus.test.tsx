// The board follows the sidebar: the workspace Orca has focused names the project whose work the
// board shows, and the board is read again when the selection moves.
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import { fixturePayload } from './panel-fixture'
import type { BoardPayload, SnapshotProject } from './model'

/** The project on another host: known, not collected. */
const REMOTE: SnapshotProject = {
  id: 'ssh:yolo|C:/work/remote',
  name: 'remote',
  host: 'ssh:yolo',
  path: 'C:/work/remote',
  openspec: null,
  superpowers: null,
  openspecCli: null,
  scannedAt: ''
}

/** A board with work of two projects, and the local one focused. */
const focusedPayload: BoardPayload = {
  ...fixturePayload,
  items: [
    ...fixturePayload.items,
    {
      ...fixturePayload.items[0]!,
      id: 'ssh:yolo|C:/work/remote#add-remote',
      projectId: REMOTE.id,
      title: 'Add Remote'
    }
  ],
  projects: [...fixturePayload.projects, REMOTE],
  focus: { projectId: 'local|/repo', workspaceId: 'w1', host: 'local', path: '/repo' }
}

test('the board shows the work of the project the sidebar has selected', async () => {
  const host = mockHost({ requests: { 'board.get': () => focusedPayload } })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: 'Add X' }))
  // The work of the other projects is not on this board.
  assert.equal(view.find({ text: 'Add Remote' }), null)
  assert.equal(view.find({ text: 'Add Y' }), null)
  // The rail counts the work of the focused project alone: two of its changes are implementing,
  // and the third one is being validated.
  assert.ok(view.find({ type: 'Button', text: '实现 2' }))
  assert.ok(view.find({ type: 'Button', text: '校验 1' }))
  await view.unmount()
})

test('the board shows every project when nothing is selected', async () => {
  const host = mockHost({
    requests: { 'board.get': () => ({ ...focusedPayload, focus: null }) }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: 'Add X' }))
  assert.ok(view.find({ text: 'Add Remote' }))
  await view.unmount()
})

test('the board is read again when the sidebar selects another workspace', async () => {
  const host = mockHost({ requests: { 'board.get': () => focusedPayload } })
  const view = await mount(panel, { host })
  const before = host.callsOf('plugin.request').length
  await view.emit('workspace.changed', {
    context: { workspaceId: 'w2', branch: 'main', displayName: 'demo', terminals: [] }
  })
  await view.settled()
  assert.ok(host.callsOf('plugin.request').length > before)
  await view.unmount()
})

test('the projects tab marks the project the sidebar has selected', async () => {
  const host = mockHost({ requests: { 'board.get': () => focusedPayload } })
  const view = await mount(panel, { host })
  await view.select({ label: '看板视图' }, 'projects')
  assert.ok(view.find({ text: '当前' }))
  await view.unmount()
})
