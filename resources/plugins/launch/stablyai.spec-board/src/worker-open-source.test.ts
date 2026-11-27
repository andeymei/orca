// Opening a file of a work item: the worker derives the path from the item's own facts, and
// opens it in the workspace that holds the project.
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as main from './worker'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, {
      recursive: true,
      force: true,
      // The worker may still be writing into the directory it was given: the removal
      // waits for it, rather than failing on a file that appeared while it ran.
      maxRetries: 5,
      retryDelay: 50
    })
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

/** A snapshot with one project and one item, as the agent would write it. */
function snapshotJson(projectId: string, changeId: string): string {
  const separator = projectId.indexOf('|')
  const host = separator > 0 ? projectId.slice(0, separator) : 'local'
  const path = separator > 0 ? projectId.slice(separator + 1) : projectId
  return JSON.stringify({
    schemaVersion: 1,
    generatedAt: '2026-11-25T10:00:00.000Z',
    generatedBy: { agent: 'claude' },
    projects: [
      {
        id: projectId,
        name: 'demo',
        host,
        path,
        openspec: { present: true, capabilities: [], activeChanges: 1, archived: 0 },
        superpowers: null,
        openspecCli: { available: true, version: '1.8.0' },
        scannedAt: '2026-11-25T10:00:00.000Z'
      }
    ],
    items: [
      {
        id: `${projectId}#${changeId}`,
        projectId,
        title: 'Add X',
        topic: changeId,
        openspec: {
          changeId,
          stage: 'implementing',
          hasProposal: true,
          hasDesign: true,
          hasTasks: true,
          tasksDone: 1,
          tasksInProgress: 0,
          tasksTotal: 4,
          capabilities: []
        },
        superpowers: null
      }
    ]
  })
}

/** A project on this machine, with a change in it, and the store the snapshot goes to. */
async function localProject(): Promise<{ root: string; path: string; id: string }> {
  const root = await home()
  const path = join(root, 'project')
  const change = join(path, 'openspec', 'changes', 'add-x')
  await mkdir(change, { recursive: true })
  await writeFile(join(change, 'proposal.md'), '# the change', 'utf8')
  await writeFile(join(change, 'tasks.md'), '- [ ] one\n', 'utf8')
  return { root, path, id: `local|${path}` }
}

/** The workspace rows Orca reports: the one that holds a project on this machine, and one on
 * another host. */
function workspacesOf(path: string): unknown {
  return {
    workspaces: [
      {
        id: 'w1',
        kind: 'worktree',
        name: 'demo',
        project: 'demo',
        projectId: 'p1',
        path,
        branch: 'main',
        hostId: 'local'
      }
    ],
    truncated: false
  }
}

test('opens a file of a work item in the editor', async () => {
  const project = await localProject()
  await writeFile(join(project.root, 'board.json'), snapshotJson(project.id, 'add-x'), 'utf8')
  const host = mockHost({
    results: {
      'workspace.list': workspacesOf(project.path),
      'workspace.open': { opened: true },
      'editor.open': { opened: true }
    }
  })
  const worker = await mountWorker(main, { host })
  await worker.request('board.get')
  const result = await worker.request('source.open', {
    itemId: `${project.id}#add-x`,
    sourceKey: 'openspec-proposal'
  })
  assert.deepEqual(result, { opened: true })
  // The path is the item's own: the worker derived it from the change the item holds.
  assert.deepEqual(host.callsOf('editor.open'), [
    { workspaceId: 'w1', path: 'openspec/changes/add-x/proposal.md' }
  ])
  // The workspace that holds the project comes to the front: a tab nobody sees is no answer.
  assert.deepEqual(host.callsOf('workspace.open'), [{ workspaceId: 'w1' }])
  await worker.deactivate()
})

test('opens the file that was named, not the first one', async () => {
  const project = await localProject()
  await writeFile(join(project.root, 'board.json'), snapshotJson(project.id, 'add-x'), 'utf8')
  const host = mockHost({
    results: {
      'workspace.list': workspacesOf(project.path),
      'workspace.open': { opened: true },
      'editor.open': { opened: true }
    }
  })
  const worker = await mountWorker(main, { host })
  await worker.request('board.get')
  await worker.request('source.open', {
    itemId: `${project.id}#add-x`,
    sourceKey: 'openspec-tasks'
  })
  assert.deepEqual(host.callsOf('editor.open'), [
    { workspaceId: 'w1', path: 'openspec/changes/add-x/tasks.md' }
  ])
  await worker.deactivate()
})

test('the file opens even when the workspace will not come to the front', async () => {
  const project = await localProject()
  await writeFile(join(project.root, 'board.json'), snapshotJson(project.id, 'add-x'), 'utf8')
  const host = mockHost({
    results: {
      'workspace.list': workspacesOf(project.path),
      'editor.open': { opened: true }
    }
  })
  const worker = await mountWorker(main, { host })
  await worker.request('board.get')
  await worker.request('source.open', {
    itemId: `${project.id}#add-x`,
    sourceKey: 'openspec-proposal'
  })
  // The workspace could not be shown, but the file opened all the same: a tab in the background
  // is better than no tab.
  assert.deepEqual(host.callsOf('editor.open'), [
    { workspaceId: 'w1', path: 'openspec/changes/add-x/proposal.md' }
  ])
  await worker.deactivate()
})

test('refuses a file the work item does not have', async () => {
  const root = await home()
  await writeFile(join(root, 'board.json'), snapshotJson('local|/repo/demo', 'add-x'), 'utf8')
  const host = mockHost({
    results: {
      'workspace.list': workspaces,
      'workspace.open': { opened: true },
      'editor.open': { opened: true }
    }
  })
  const worker = await mountWorker(main, { host })
  await worker.request('board.get')
  await assert.rejects(
    worker.request('source.open', {
      itemId: 'local|/repo/demo#add-x',
      sourceKey: 'superpowers-plan'
    }),
    /没有这个文件/
  )
  // Nothing was opened: the key named a file the item does not hold.
  assert.deepEqual(host.callsOf('editor.open'), [])
  await worker.deactivate()
})

test('refuses a work item the board does not have', async () => {
  await home()
  const host = mockHost({
    results: {
      'workspace.list': workspaces,
      'editor.open': { opened: true }
    }
  })
  const worker = await mountWorker(main, { host })
  await worker.request('board.get')
  await assert.rejects(
    worker.request('source.open', {
      itemId: 'local|/repo/demo#nothing',
      sourceKey: 'openspec-proposal'
    }),
    /找不到这个工作项/
  )
  assert.deepEqual(host.callsOf('editor.open'), [])
  await worker.deactivate()
})

test('a project with no workspace offers no file to open', async () => {
  const root = await home()
  await writeFile(join(root, 'board.json'), snapshotJson('local|/elsewhere', 'add-x'), 'utf8')
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  const payload = await worker.request('board.get')
  const item = payload.items.find((i) => i.id === 'local|/elsewhere#add-x')!
  // There is no workspace to open the file in, so the card offers no link at all.
  assert.deepEqual(item.sources, [])
  await worker.deactivate()
})

test('a file that points outside the project is not opened', async () => {
  const root = await home()
  // A repository may hold a link that points out of itself: the path that names it cannot see
  // that, so the worker resolves the file and checks where it landed.
  const project = join(root, 'project')
  const outside = join(root, 'outside.md')
  const change = join(project, 'openspec', 'changes', 'add-x')
  await mkdir(change, { recursive: true })
  await writeFile(outside, '# not the project', 'utf8')
  await symlink(outside, join(change, 'proposal.md'))
  await writeFile(join(root, 'board.json'), snapshotJson(`local|${project}`, 'add-x'), 'utf8')
  const host = mockHost({
    results: {
      'workspace.list': {
        workspaces: [
          {
            id: 'w1',
            kind: 'worktree',
            name: 'demo',
            project: 'demo',
            projectId: 'p1',
            path: project,
            branch: 'main',
            hostId: 'local'
          }
        ],
        truncated: false
      },
      'editor.open': { opened: true }
    }
  })
  const worker = await mountWorker(main, { host })
  await worker.request('board.get')
  await assert.rejects(
    worker.request('source.open', {
      itemId: `local|${project}#add-x`,
      sourceKey: 'openspec-proposal'
    }),
    /不在项目里/
  )
  // Nothing was opened: the file the link named lives outside the project.
  assert.deepEqual(host.callsOf('editor.open'), [])
  await worker.deactivate()
})

test('a file of the project itself is opened', async () => {
  const root = await home()
  const project = join(root, 'project')
  const change = join(project, 'openspec', 'changes', 'add-x')
  await mkdir(change, { recursive: true })
  await writeFile(join(change, 'proposal.md'), '# the project', 'utf8')
  await writeFile(join(root, 'board.json'), snapshotJson(`local|${project}`, 'add-x'), 'utf8')
  const host = mockHost({
    results: {
      'workspace.list': {
        workspaces: [
          {
            id: 'w1',
            kind: 'worktree',
            name: 'demo',
            project: 'demo',
            projectId: 'p1',
            path: project,
            branch: 'main',
            hostId: 'local'
          }
        ],
        truncated: false
      },
      'editor.open': { opened: true }
    }
  })
  const worker = await mountWorker(main, { host })
  await worker.request('board.get')
  const result = await worker.request('source.open', {
    itemId: `local|${project}#add-x`,
    sourceKey: 'openspec-proposal'
  })
  assert.deepEqual(result, { opened: true })
  assert.deepEqual(host.callsOf('editor.open'), [
    { workspaceId: 'w1', path: 'openspec/changes/add-x/proposal.md' }
  ])
  await worker.deactivate()
})

test('a project that is not there opens nothing', async () => {
  const root = await home()
  // The workspace names a directory this machine does not have: there is nothing inside it to
  // open, and a check that cannot say where a file is does not get to open it.
  await writeFile(join(root, 'board.json'), snapshotJson('local|/nowhere/demo', 'add-x'), 'utf8')
  const host = mockHost({
    results: {
      'workspace.list': workspacesOf('/nowhere/demo'),
      'editor.open': { opened: true }
    }
  })
  const worker = await mountWorker(main, { host })
  await worker.request('board.get')
  await assert.rejects(
    worker.request('source.open', {
      itemId: 'local|/nowhere/demo#add-x',
      sourceKey: 'openspec-proposal'
    }),
    /不在项目里/
  )
  assert.deepEqual(host.callsOf('editor.open'), [])
  await worker.deactivate()
})

test('a project on another host is opened on that host', async () => {
  const root = await home()
  // The file lives on the other machine, so this one cannot resolve it: the path's own gate is
  // what holds, and the host opens the file over there.
  await writeFile(join(root, 'board.json'), snapshotJson('ssh:yolo|C:/work/remote', 'add-x'), 'utf8')
  const host = mockHost({
    results: {
      'workspace.list': {
        workspaces: [
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
      },
      'editor.open': { opened: true }
    }
  })
  const worker = await mountWorker(main, { host })
  await worker.request('board.get')
  const result = await worker.request('source.open', {
    itemId: 'ssh:yolo|C:/work/remote#add-x',
    sourceKey: 'openspec-proposal'
  })
  assert.deepEqual(result, { opened: true })
  assert.deepEqual(host.callsOf('editor.open'), [
    { workspaceId: 'w2', path: 'openspec/changes/add-x/proposal.md' }
  ])
  await worker.deactivate()
})
