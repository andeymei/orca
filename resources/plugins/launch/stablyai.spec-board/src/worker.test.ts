// The worker: it merges the agent's snapshot with the local scan, refreshes the snapshot, and
// runs the actions the board offers.
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as main from './worker'
import { cliProbe } from './openspec-cli'
import { isRecord } from './unknown-values'

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

/** The board faces a machine the probe cannot tell anything about. */
function machineCannotTell(): void {
  cliProbe.read = async () => null
}

async function home(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spec-board-home-'))
  roots.push(root)
  process.env.SPEC_BOARD_HOME = root
  return root
}

/** One string field of a host call's params, as the test reads it. */
function callString(params: unknown, field: string): string {
  assert.ok(isRecord(params))
  const value = params[field]
  assert.ok(typeof value === 'string')
  return value
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

test('an empty registry does not lock the board empty', async () => {
  const root = await home()
  await writeFile(
    join(root, 'projects.json'),
    JSON.stringify({ schemaVersion: 1, projects: [] }),
    'utf8'
  )
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  const payload = await worker.request('board.get')
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

test('a local project that has the capability reports the archived change as stale', async () => {
  const root = await home()
  const project = join(root, 'project')
  await mkdir(join(project, 'openspec', 'specs', 'core'), { recursive: true })
  await writeFile(
    join(root, 'board.json'),
    snapshotJson(`local|${project}`, 'add-x', {
      stage: 'archived',
      tasksDone: 4,
      capabilities: ['other']
    }),
    'utf8'
  )
  const host = mockHost({
    results: { 'workspace.list': workspaces },
    settings: { scanRoots: project }
  })
  const worker = await mountWorker(main, { host })
  const payload = await worker.request('board.get')
  const item = payload.items.find((i) => i.projectId === `local|${project}`)!
  assert.ok(item.gaps.some((gap) => gap.code === 'archived-spec-stale'))
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
  const created = host.callsOf('terminal.create')[0]
  assert.equal(callString(created, 'workspaceId'), 'w1')
  assert.equal(callString(created, 'command'), 'openspec validate add-x --strict')
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
  assert.deepEqual(result, { kind: 'agent', terminalId: 't9', agent: 'claude' })
  assert.deepEqual(host.callsOf('terminal.create'), [])
  await worker.deactivate()
})

test('the answer names the agent the worker launched', async () => {
  const root = await home()
  machineHasCli(false)
  await writeFile(join(root, 'board.json'), snapshotJson('local|/repo/demo', 'add-x'), 'utf8')
  const host = mockHost({
    results: {
      'workspace.list': workspaces,
      'agent.launch': { terminalId: 't9' },
      'terminal.create': { terminalId: 't1' }
    },
    settings: { refreshAgent: 'codex' }
  })
  const worker = await mountWorker(main, { host })
  await worker.request('board.get')
  const result = await worker.request('action.run', {
    projectId: 'local|/repo/demo',
    actionId: 'openspec.validate',
    itemId: 'local|/repo/demo#add-x'
  })
  // The panel says who took the action, so the answer names the agent that did.
  assert.deepEqual(result, { kind: 'agent', terminalId: 't9', agent: 'codex' })
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
  // The CLI is on the other machine, and this desktop cannot run a command there: the action is
  // a prompt the agent carries over.
  assert.equal(validate?.run.kind, 'agent')
  await worker.deactivate()
})

test('a probe that cannot tell does not overrule the agent about the CLI', async () => {
  const root = await home()
  machineCannotTell()
  await writeFile(join(root, 'board.json'), snapshotJson('local|/repo/demo', 'add-x'), 'utf8')
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  const payload = await worker.request('board.get')
  const project = payload.projects.find((p) => p.id === 'local|/repo/demo')!
  // The agent says the CLI is there, and the probe could not tell: the answer that stands is the
  // agent's, not a false 无 CLI.
  assert.equal(project.openspecCli?.available, true)
  await worker.deactivate()
})

test('a project nobody answered for stays unknown when the probe cannot tell', async () => {
  const root = await home()
  const other = join(root, 'other')
  await mkdir(other, { recursive: true })
  machineCannotTell()
  await writeFile(join(root, 'board.json'), snapshotJson('local|/repo/demo', 'add-x'), 'utf8')
  const host = mockHost({
    results: { 'workspace.list': workspaces },
    settings: { scanRoots: other }
  })
  const worker = await mountWorker(main, { host })
  const payload = await worker.request('board.get')
  const unknown = payload.projects.find((p) => p.path === other)!
  // The probe could not tell, so the board says it does not know — not that there is no CLI.
  assert.equal(unknown.openspecCli, null)
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

test('the board says which of its projects a workspace holds', async () => {
  const root = await home()
  await writeFile(join(root, 'board.json'), snapshotJson('local|/elsewhere', 'add-x'), 'utf8')
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  const payload = await worker.request('board.get')
  // The panel draws the consequence: the actions of a project no workspace holds are off.
  const held = payload.projects.find((p) => p.id === 'local|/repo/demo')!
  assert.equal(held.canRun, true)
  const elsewhere = payload.projects.find((p) => p.id === 'local|/elsewhere')!
  assert.equal(elsewhere.canRun, false)
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
  const created = host.callsOf('terminal.create')[0]
  assert.equal(callString(created, 'command'), 'openspec validate add-x --strict')
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

test('the fallback registry is written once, with the projects of every host', async () => {
  const root = await home()
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  await worker.request('board.get')
  const written = JSON.parse(await readFile(join(root, 'projects.json'), 'utf8'))
  // The remote project is in the registry too: it is the only place the agent learns of it, so
  // a registry without it would leave that project empty on the board forever.
  assert.deepEqual(written.projects, [
    { name: 'demo', host: 'local', path: '/repo/demo' },
    { name: 'remote', host: 'ssh:yolo', path: 'C:/work/remote' }
  ])
  await worker.deactivate()
})

test('a failed workspace list does not write an empty registry', async () => {
  const root = await home()
  // No result for workspace.list: the host refuses the call, the way it does when it cannot
  // answer.
  const host = mockHost({ results: {} })
  const worker = await mountWorker(main, { host })
  const payload = await worker.request('board.get')
  assert.ok(payload.warnings.some((w) => w.includes('workspace')))
  // The fallback is only written when the scan found something: an empty registry would lock
  // the board empty.
  await assert.rejects(readFile(join(root, 'projects.json'), 'utf8'))
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

test('an action on a remote project runs in a local workspace, as a prompt', async () => {
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
      'agent.launch': { terminalId: 't3' },
      'terminal.create': { terminalId: 't2' }
    }
  })
  const worker = await mountWorker(main, { host })
  await worker.request('board.get')
  const result = await worker.request('action.run', {
    projectId: 'ssh:yolo|C:/work/remote',
    actionId: 'openspec.validate',
    itemId: 'ssh:yolo|C:/work/remote#add-y'
  })
  // The agent runs here — this desktop cannot dispatch into another machine — and reaches the
  // project over ssh.
  assert.deepEqual(result, { kind: 'agent', terminalId: 't3', agent: 'claude' })
  assert.deepEqual(host.callsOf('terminal.create'), [])
  const launched = host.callsOf('agent.launch')[0]
  assert.equal(callString(launched, 'workspaceId'), 'w1')
  const prompt = callString(launched, 'prompt')
  assert.match(prompt, /ssh:yolo/)
  assert.match(prompt, /C:\/work\/remote/)
  await worker.deactivate()
})

test('a broken snapshot keeps the last snapshot that parsed', async () => {
  const root = await home()
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  await writeFile(join(root, 'board.json'), snapshotJson('local|/repo/demo', 'add-x'), 'utf8')
  const first = await worker.request('board.get')
  assert.ok(first.items.length > 0)
  const at = first.sources.agentAt
  await writeFile(join(root, 'board.json'), '{ not json', 'utf8')
  const second = await worker.request('board.get')
  assert.ok(second.warnings.some((w) => w.includes('board.json')))
  assert.equal(second.items.length, first.items.length)
  assert.equal(second.sources.agentAt, at)
  await worker.deactivate()
})

test('the worker starts even when the store directory cannot be created', async () => {
  const root = await home()
  // The store directory points inside a file, so it can never be a directory.
  const blocker = join(root, 'blocker')
  await writeFile(blocker, 'x', 'utf8')
  process.env.SPEC_BOARD_HOME = join(blocker, 'store')
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  const payload = await worker.request('board.get')
  assert.equal(
    payload.projects.some((p) => p.id === 'local|/repo/demo'),
    true
  )
  await worker.deactivate()
})

test('a new snapshot reaches the open panels', async () => {
  const root = await home()
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  await worker.request('board.get')
  const file = join(root, 'board.json')
  await writeFile(file, snapshotJson('local|/repo/demo', 'add-x'), 'utf8')
  const posted = await waitFor(() =>
    worker.posts.some((post) => post.event === 'board.changed')
  )
  assert.equal(posted, true)
  const mtime = (await stat(file)).mtimeMs
  const posts = worker.posts.filter((post) => post.event === 'board.changed')
  assert.ok(
    posts.some((post) => {
      const payload = post.payload
      assert.ok(isRecord(payload))
      return payload['agentAt'] === mtime
    })
  )
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
