// The board's projects and the one the sidebar has selected: the board follows the sidebar, and
// a project on another host is on the board even though this worker cannot read it.
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

test('an empty registry is filled with the projects Orca knows', async () => {
  const root = await home()
  await writeFile(
    join(root, 'projects.json'),
    JSON.stringify({ schemaVersion: 1, projects: [] }),
    'utf8'
  )
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  const payload = await worker.request('board.get')
  // The empty registry names nothing, and the board is not empty: Orca's projects are on it.
  assert.equal(payload.projects.length, 2)
  // And the file is filled in, so the person can see — and edit — what the board knows.
  const written = JSON.parse(await readFile(join(root, 'projects.json'), 'utf8'))
  assert.deepEqual(
    written.projects.map((project: { path: string }) => project.path),
    ['/repo/demo', 'C:/work/remote']
  )
  await worker.deactivate()
})

/** The paired Orca server: the environment id it is reached by, and the project it holds. */
const PAIRED_ENVIRONMENT_ID = 'db289643-131b-44b3-be01-eac5b5410e48'
const PAIRED_PATH = 'D:/ctjt/code/ctjt-platform/ctjt-service'

/** The workspace the paired server holds, as Orca lists it. */
const pairedWorkspace = {
  id: `wt-remote-1::${PAIRED_PATH}`,
  kind: 'worktree',
  name: 'ctjt-service',
  project: 'ctjt-service',
  projectId: 'repo-remote-1',
  path: PAIRED_PATH,
  branch: 'main',
  hostId: `runtime:${PAIRED_ENVIRONMENT_ID}`
}

/** The project of the paired server, as Orca lists it. */
const pairedProjectList = {
  projects: [
    {
      id: 'repo-remote-1',
      name: 'ctjt-service',
      kind: 'git',
      hostId: `runtime:${PAIRED_ENVIRONMENT_ID}`,
      path: PAIRED_PATH,
      hidden: false
    }
  ],
  truncated: false
}

test('the project of a paired Orca server is on the board, under that server', async () => {
  await home()
  const host = mockHost({
    results: {
      'workspace.list': { workspaces: [pairedWorkspace], truncated: false },
      'project.list': pairedProjectList
    }
  })
  const worker = await mountWorker(main, { host })
  const payload = await worker.request('board.get')
  const project = payload.projects.find(
    (entry) => entry.id === `runtime:${PAIRED_ENVIRONMENT_ID}|${PAIRED_PATH}`
  )
  assert.ok(project)
  assert.equal(project.name, 'ctjt-service')
  assert.equal(project.host, `runtime:${PAIRED_ENVIRONMENT_ID}`)
  // Nobody has read it yet: the worker cannot read a project on another host by itself.
  assert.equal(project.openspec, null)
  await worker.deactivate()
})

test('the board follows the sidebar into a paired server’s project', async () => {
  await home()
  const host = mockHost({
    results: {
      'workspace.list': { workspaces: [pairedWorkspace], truncated: false },
      'project.list': pairedProjectList,
      'workspace.readContext': {
        workspaceId: pairedWorkspace.id,
        branch: 'main',
        displayName: 'ctjt-service',
        terminals: []
      }
    }
  })
  const worker = await mountWorker(main, { host })
  const payload = await worker.request('board.get')
  assert.equal(payload.focus?.projectId, `runtime:${PAIRED_ENVIRONMENT_ID}|${PAIRED_PATH}`)
  assert.equal(payload.focus?.workspaceId, pairedWorkspace.id)
  await worker.deactivate()
})
