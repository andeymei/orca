// The board's projects and the one the sidebar has selected: the board follows the sidebar, and
// a project on another host is on the board even though this worker cannot read it.
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as main from './worker'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
  delete process.env.SPEC_BOARD_HOME
})

/** The plugin's own files live in a directory of their own. */
async function home(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spec-board-home-'))
  roots.push(root)
  process.env.SPEC_BOARD_HOME = root
  return root
}

/** One workspace on this machine and one on another host. */
const workspaces = {
  workspaces: [
    {
      id: 'w1',
      kind: 'worktree',
      name: 'demo',
      project: 'demo',
      projectId: 'p1',
      path: '/repo/demo',
      branch: 'main',
      hostId: 'local'
    },
    {
      id: 'w2',
      kind: 'worktree',
      name: 'remote',
      project: 'remote',
      projectId: 'p2',
      path: 'C:/work/remote',
      branch: 'main',
      hostId: 'ssh:yolo'
    }
  ],
  truncated: false
}

test('the board names the project the sidebar has selected', async () => {
  await home()
  const host = mockHost({
    results: {
      'workspace.list': workspaces,
      'workspace.readContext': {
        workspaceId: 'w2',
        branch: 'main',
        displayName: 'remote',
        terminals: []
      }
    }
  })
  const worker = await mountWorker(main, { host })
  const payload = await worker.request('board.get')
  assert.equal(payload.focus?.projectId, 'ssh:yolo|C:/work/remote')
  assert.equal(payload.focus?.workspaceId, 'w2')
  await worker.deactivate()
})

test('a project on another host is on the board, waiting for the agent', async () => {
  await home()
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  const payload = await worker.request('board.get')
  const remote = payload.projects.find((project) => project.id === 'ssh:yolo|C:/work/remote')
  assert.ok(remote)
  // Nobody has read it: the worker cannot read a project on another host.
  assert.equal(remote.openspec, null)
  assert.equal(remote.superpowers, null)
  await worker.deactivate()
})
