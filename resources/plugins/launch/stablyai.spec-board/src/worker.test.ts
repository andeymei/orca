// The worker: it merges the agent's snapshot with the local scan, refreshes the snapshot, and
// runs the actions the board offers.
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as main from './worker'
import { cliProbe } from './openspec-cli'

const roots: string[] = []
const realProbe = cliProbe.read

afterEach(async () => {
  cliProbe.read = realProbe
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
  delete process.env.SPEC_BOARD_HOME
})

/** The board sees a machine with, or without, the OpenSpec CLI. */
function machineHasCli(available: boolean): void {
  cliProbe.read = async () =>
    available ? { available: true, version: '1.8.0' } : { available: false }
}

async function home(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spec-board-home-'))
  roots.push(root)
  process.env.SPEC_BOARD_HOME = root
  return root
}

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
function snapshotJson(
  projectId: string,
  changeId: string,
  openspec: Record<string, unknown> = {}
): string {
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
          capabilities: [],
          ...openspec
        },
        superpowers: null
      }
    ]
  })
}

test('merges the agent snapshot over the local scan', async () => {
  const root = await home()
  await writeFile(
    join(root, 'board.json'),
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: '2026-11-25T10:00:00.000Z',
      generatedBy: { agent: 'claude' },
      projects: [
        {
          id: 'ssh:yolo|C:/work/remote',
          name: 'remote',
          host: 'ssh:yolo',
          path: 'C:/work/remote',
          openspec: { present: true, capabilities: [], activeChanges: 1, archived: 0 },
          superpowers: null,
          openspecCli: { available: true, version: '1.8.0' },
          scannedAt: '2026-11-25T10:00:00.000Z'
        }
      ],
      items: [
        {
          id: 'ssh:yolo|C:/work/remote#add-y',
          projectId: 'ssh:yolo|C:/work/remote',
          title: 'Add Y',
          topic: 'add-y',
          openspec: {
            changeId: 'add-y',
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
    }),
    'utf8'
  )
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  const payload = await worker.request('board.get')
  assert.equal(
    payload.projects.some((p) => p.id === 'ssh:yolo|C:/work/remote'),
    true
  )
  const remote = payload.items.find((i) => i.projectId === 'ssh:yolo|C:/work/remote')!
  assert.equal(remote.stage, 'implement')
  assert.equal(remote.gaps[0]?.code, 'openspec-only')
  assert.ok(remote.actions.length > 0)
  assert.equal(payload.sources.agentAt !== null, true)
  await worker.deactivate()
})

test('reports a broken snapshot without losing the local scan', async () => {
  const root = await home()
  await writeFile(join(root, 'board.json'), '{ not json', 'utf8')
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  const payload = await worker.request('board.get')
  assert.ok(payload.warnings.some((w) => w.includes('board.json')))
  assert.equal(payload.sources.agentAt, null)
  // The local scan still ran: the project Orca reported is on the board.
  assert.equal(
    payload.projects.some((p) => p.id === 'local|/repo/demo'),
    true
  )
  await worker.deactivate()
})

test('a malformed registry is a warning, and the local scan still runs', async () => {
  const root = await home()
  await writeFile(join(root, 'projects.json'), '{ not json', 'utf8')
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  const payload = await worker.request('board.get')
  assert.ok(payload.warnings.some((w) => w.includes('projects.json')))
  assert.equal(
    payload.projects.some((p) => p.id === 'local|/repo/demo'),
    true
  )
  await worker.deactivate()
})

test('runs a terminal action on the workspace that owns the project', async () => {
  const root = await home()
  machineHasCli(true)
  // The local scan finds nothing on a fake path, so the item under test comes from the snapshot.
  await writeFile(join(root, 'board.json'), snapshotJson('local|/repo/demo', 'add-x'), 'utf8')
  const host = mockHost({
    results: {
      'workspace.list': workspaces,
      'terminal.create': { terminalId: 't1' },
      'terminal.focus': { focused: true }
    }
  })
  const worker = await mountWorker(main, { host })
  await worker.request('board.get')
  const result = await worker.request('action.run', {
    projectId: 'local|/repo/demo',
    actionId: 'openspec.validate',
    itemId: 'local|/repo/demo#add-x'
  })
  assert.deepEqual(result, { kind: 'terminal', terminalId: 't1' })
  const created = host.callsOf('terminal.create')[0] as {
    workspaceId: string
    command: string
  }
  assert.equal(created.workspaceId, 'w1')
  assert.equal(created.command, 'openspec validate add-x --strict')
  // The terminal is focused, so the command and its output are visible.
  assert.deepEqual(host.callsOf('terminal.focus'), [{ terminalId: 't1' }])
  await worker.deactivate()
})

test('refuses an action for a project with no matching workspace', async () => {
  await home()
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  await worker.request('board.get')
  await assert.rejects(
    worker.request('action.run', { projectId: 'local|/nowhere', actionId: 'openspec.validate' }),
    /workspace/
  )
  assert.deepEqual(host.callsOf('terminal.create'), [])
  await worker.deactivate()
})

test('the CLI probe decides for a local project', async () => {
  const root = await home()
  machineHasCli(false)
  await writeFile(join(root, 'board.json'), snapshotJson('local|/repo/demo', 'add-x'), 'utf8')
  const host = mockHost({
    results: {
      'workspace.list': workspaces,
      'agent.launch': { terminalId: 't9' },
      'terminal.create': { terminalId: 't1' }
    }
  })
  const worker = await mountWorker(main, { host })
  const payload = await worker.request('board.get')
  const item = payload.items.find((i) => i.id === 'local|/repo/demo#add-x')!
  // The snapshot says the CLI is there; this machine says it is not, and this machine wins.
  const validate = item.actions.find((action) => action.id === 'openspec.validate')
  assert.equal(validate?.run.kind, 'agent')
  const result = await worker.request('action.run', {
    projectId: 'local|/repo/demo',
    actionId: 'openspec.validate',
    itemId: 'local|/repo/demo#add-x'
  })
  assert.deepEqual(result, { kind: 'agent', terminalId: 't9' })
  assert.deepEqual(host.callsOf('terminal.create'), [])
  await worker.deactivate()
})

test('a remote project keeps the answer the agent gave about the CLI', async () => {
  const root = await home()
  machineHasCli(false)
  await writeFile(
    join(root, 'board.json'),
    snapshotJson('ssh:yolo|C:/work/remote', 'add-y'),
    'utf8'
  )
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  const payload = await worker.request('board.get')
  const project = payload.projects.find((p) => p.id === 'ssh:yolo|C:/work/remote')!
  assert.equal(project.openspecCli?.available, true)
  const item = payload.items.find((i) => i.projectId === 'ssh:yolo|C:/work/remote')!
  const validate = item.actions.find((action) => action.id === 'openspec.validate')
  assert.equal(validate?.run.kind, 'terminal')
  await worker.deactivate()
})

test('an item of another project is refused, and nothing runs', async () => {
  const root = await home()
  machineHasCli(true)
  await writeFile(
    join(root, 'board.json'),
    snapshotJson('ssh:yolo|C:/work/remote', 'add-y'),
    'utf8'
  )
  const host = mockHost({
    results: {
      'workspace.list': workspaces,
      'terminal.create': { terminalId: 't1' },
      'terminal.focus': { focused: true }
    }
  })
  const worker = await mountWorker(main, { host })
  await worker.request('board.get')
  await assert.rejects(
    worker.request('action.run', {
      projectId: 'local|/repo/demo',
      actionId: 'openspec.validate',
      itemId: 'ssh:yolo|C:/work/remote#add-y'
    }),
    /不属于/
  )
  assert.deepEqual(host.callsOf('terminal.create'), [])
  await worker.deactivate()
})

test('a project that is not on the board is refused', async () => {
  const root = await home()
  machineHasCli(true)
  await writeFile(join(root, 'board.json'), snapshotJson('local|/repo/demo', 'add-x'), 'utf8')
  const host = mockHost({
    results: {
      'workspace.list': workspaces,
      'terminal.create': { terminalId: 't1' },
      'terminal.focus': { focused: true }
    }
  })
  const worker = await mountWorker(main, { host })
  await worker.request('board.get')
  // The id names the directory of a workspace, but it is not the id of a project on the board,
  // so it names nothing: the request may not choose the directory the command runs in.
  await assert.rejects(
    worker.request('action.run', {
      projectId: 'local|/repo/demo/',
      actionId: 'openspec.validate',
      changeId: 'add-x'
    }),
    /workspace/
  )
  assert.deepEqual(host.callsOf('terminal.create'), [])
  await worker.deactivate()
})

test('a project on the board with no workspace is refused', async () => {
  const root = await home()
  machineHasCli(true)
  await writeFile(join(root, 'board.json'), snapshotJson('local|/elsewhere', 'add-x'), 'utf8')
  const host = mockHost({
    results: {
      'workspace.list': workspaces,
      'terminal.create': { terminalId: 't1' },
      'terminal.focus': { focused: true }
    }
  })
  const worker = await mountWorker(main, { host })
  await worker.request('board.get')
  await assert.rejects(
    worker.request('action.run', {
      projectId: 'local|/elsewhere',
      actionId: 'openspec.validate',
      itemId: 'local|/elsewhere#add-x'
    }),
    /workspace/
  )
  assert.deepEqual(host.callsOf('terminal.create'), [])
  await worker.deactivate()
})

test('the palette needs a change id', async () => {
  await home()
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  await worker.request('board.get')
  await assert.rejects(
    worker.request('action.run', { projectId: 'local|/repo/demo', actionId: 'openspec.validate' }),
    /请先选择一个变更/
  )
  assert.deepEqual(host.callsOf('terminal.create'), [])
  await worker.deactivate()
})

test('the palette refuses an unsafe change id, and the board says why', async () => {
  await home()
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  await worker.request('board.get')
  await assert.rejects(
    worker.request('action.run', {
      projectId: 'local|/repo/demo',
      actionId: 'openspec.validate',
      changeId: 'x; rm -rf /'
    }),
    /变更 id 不安全/
  )
  const payload = await worker.request('board.get')
  assert.ok(
    payload.warnings.some((w) => w.includes('变更 id 不安全') && w.includes('x; rm -rf /'))
  )
  await worker.deactivate()
})

test("the item's own action wins over a change id", async () => {
  const root = await home()
  machineHasCli(true)
  await writeFile(join(root, 'board.json'), snapshotJson('local|/repo/demo', 'add-x'), 'utf8')
  const host = mockHost({
    results: {
      'workspace.list': workspaces,
      'terminal.create': { terminalId: 't1' },
      'terminal.focus': { focused: true }
    }
  })
  const worker = await mountWorker(main, { host })
  await worker.request('board.get')
  await worker.request('action.run', {
    projectId: 'local|/repo/demo',
    actionId: 'openspec.validate',
    itemId: 'local|/repo/demo#add-x',
    changeId: 'other-change'
  })
  const created = host.callsOf('terminal.create')[0] as { command: string }
  assert.equal(created.command, 'openspec validate add-x --strict')
  await worker.deactivate()
})

test('an action the item does not offer is refused', async () => {
  const root = await home()
  await writeFile(join(root, 'board.json'), snapshotJson('local|/repo/demo', 'add-x'), 'utf8')
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  await worker.request('board.get')
  await assert.rejects(
    worker.request('action.run', {
      projectId: 'local|/repo/demo',
      actionId: 'openspec.list',
      itemId: 'local|/repo/demo#add-x'
    }),
    /没有这个动作/
  )
  assert.deepEqual(host.callsOf('terminal.create'), [])
  await worker.deactivate()
})

test('a snapshot with an unsafe change id is warned about', async () => {
  const root = await home()
  await writeFile(join(root, 'board.json'), snapshotJson('local|/repo/demo', 'add x'), 'utf8')
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  const payload = await worker.request('board.get')
  assert.ok(payload.warnings.some((w) => w.includes('变更 id 不安全') && w.includes('add x')))
  const item = payload.items.find((i) => i.projectId === 'local|/repo/demo')!
  assert.equal(
    item.actions.some((action) => action.id === 'openspec.validate'),
    false
  )
  await worker.deactivate()
})

test('an archived change of a remote project is not reported as stale', async () => {
  const root = await home()
  await writeFile(
    join(root, 'board.json'),
    snapshotJson('ssh:yolo|C:/work/remote', 'add-x', {
      stage: 'archived',
      tasksDone: 4,
      capabilities: ['core']
    }),
    'utf8'
  )
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  const payload = await worker.request('board.get')
  const item = payload.items.find((i) => i.projectId === 'ssh:yolo|C:/work/remote')!
  assert.equal(
    item.gaps.some((gap) => gap.code === 'archived-spec-stale'),
    false
  )
  await worker.deactivate()
})

test('the fallback registry is written once, so the person can add the remote projects', async () => {
  const root = await home()
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  await worker.request('board.get')
  const written = JSON.parse(await readFile(join(root, 'projects.json'), 'utf8'))
  assert.deepEqual(written.projects, [{ name: 'demo', host: 'local', path: '/repo/demo' }])
  await worker.deactivate()
})

test('the local scan is dated, so the board can say when it ran', async () => {
  await home()
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  const payload = await worker.request('board.get')
  assert.equal(payload.sources.localAt !== null, true)
  await worker.deactivate()
})

test('the extra scan roots of the setting are scanned too', async () => {
  const root = await home()
  const project = join(root, 'project')
  await mkdir(join(project, 'openspec', 'changes', 'add-y'), { recursive: true })
  await writeFile(join(project, 'openspec', 'changes', 'add-y', 'proposal.md'), '# x', 'utf8')
  const host = mockHost({
    results: { 'workspace.list': workspaces },
    settings: { scanRoots: `${project}\n` }
  })
  const worker = await mountWorker(main, { host })
  const payload = await worker.request('board.get')
  assert.equal(
    payload.items.some((item) => item.topic === 'add-y'),
    true
  )
  await worker.deactivate()
})

test('refresh writes the prompt it will send and launches the agent', async () => {
  const root = await home()
  const host = mockHost({
    results: {
      'workspace.list': workspaces,
      'workspace.readContext': {
        workspaceId: 'w1',
        branch: 'main',
        displayName: 'demo',
        terminals: []
      },
      'agent.launch': { terminalId: 't9' }
    }
  })
  const worker = await mountWorker(main, { host })
  await worker.request('board.refresh')
  const launched = host.callsOf('agent.launch')[0] as {
    workspaceId: string
    agent: string
    prompt: string
  }
  assert.equal(launched.workspaceId, 'w1')
  assert.equal(launched.agent, 'claude')
  assert.ok(launched.prompt.includes(join(root, 'board.json')))
  const written = await readFile(join(root, 'last-refresh-prompt.md'), 'utf8')
  assert.equal(written, launched.prompt)
  await worker.deactivate()
})

test('refresh runs in the workspace the setting names', async () => {
  await home()
  const host = mockHost({
    results: {
      'workspace.list': workspaces,
      'workspace.readContext': {
        workspaceId: 'w1',
        branch: 'main',
        displayName: 'demo',
        terminals: []
      },
      'agent.launch': { terminalId: 't9' }
    },
    settings: { refreshWorkspace: 'w2' }
  })
  const worker = await mountWorker(main, { host })
  await worker.request('board.refresh')
  const launched = host.callsOf('agent.launch')[0] as { workspaceId: string }
  assert.equal(launched.workspaceId, 'w2')
  assert.deepEqual(host.callsOf('workspace.readContext'), [])
  await worker.deactivate()
})

test('a new snapshot reaches the open panels', async () => {
  const root = await home()
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  await worker.request('board.get')
  await writeFile(join(root, 'board.json'), snapshotJson('local|/repo/demo', 'add-x'), 'utf8')
  const posted = await waitFor(() =>
    worker.posts.some((post) => post.event === 'board.changed')
  )
  assert.equal(posted, true)
  await worker.deactivate()
})

/** Waits for a condition the file watcher makes true; it is a filesystem event, not a promise. */
async function waitFor(condition: () => boolean): Promise<boolean> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (condition()) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return condition()
}
