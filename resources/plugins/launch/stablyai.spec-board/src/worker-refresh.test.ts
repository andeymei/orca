// The refresh: the worker starts the agent that writes the snapshot. It runs on this machine —
// the snapshot has to be where this worker reads it — and it hands the agent the list of
// projects to scan, so the ones on another host are collected too.
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as main from './worker'
import { errorCode, isRecord } from './unknown-values'

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

/** One string field of a host call's params, as the test reads it. */
function callString(params: unknown, field: string): string {
  assert.ok(isRecord(params))
  const value = params[field]
  assert.ok(typeof value === 'string')
  return value
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
  const launched = host.callsOf('agent.launch')[0]
  assert.equal(callString(launched, 'workspaceId'), 'w1')
  assert.equal(callString(launched, 'agent'), 'claude')
  assert.ok(callString(launched, 'prompt').includes(join(root, 'board.json')))
  const written = await readFile(join(root, 'last-refresh-prompt.md'), 'utf8')
  assert.equal(written, callString(launched, 'prompt'))
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
    settings: { refreshWorkspace: 'w1' }
  })
  const worker = await mountWorker(main, { host })
  await worker.request('board.refresh')
  const launched = host.callsOf('agent.launch')[0]
  assert.equal(callString(launched, 'workspaceId'), 'w1')
  assert.deepEqual(host.callsOf('workspace.readContext'), [])
  await worker.deactivate()
})

test('a refresh in a workspace on another host is refused, and says why', async () => {
  await home()
  const host = mockHost({
    results: {
      'workspace.list': workspaces,
      'agent.launch': { terminalId: 't9' }
    },
    settings: { refreshWorkspace: 'w2' }
  })
  const worker = await mountWorker(main, { host })
  // The snapshot would be written on that other host, where this worker never reads it.
  await assert.rejects(worker.request('board.refresh'), (error: unknown) => {
    return errorCode(error) === 'invalid_params' && String(error).includes('本机')
  })
  assert.deepEqual(host.callsOf('agent.launch'), [])
  await worker.deactivate()
})

test('a refresh without a workspace on this machine is refused with invalid_params', async () => {
  await home()
  const host = mockHost({
    results: {
      // Only a workspace on another host: the snapshot has to be written where this worker
      // reads it, and that is never another machine.
      'workspace.list': {
        workspaces: [workspaces.workspaces[1]],
        truncated: false
      },
      'workspace.readContext': null
    }
  })
  const worker = await mountWorker(main, { host })
  await assert.rejects(worker.request('board.refresh'), (error: unknown) => {
    return errorCode(error) === 'invalid_params'
  })
  await worker.deactivate()
})

test('a refresh with no focused workspace runs in a local one', async () => {
  await home()
  const host = mockHost({
    results: {
      'workspace.list': workspaces,
      'workspace.readContext': null,
      'agent.launch': { terminalId: 't9' }
    }
  })
  const worker = await mountWorker(main, { host })
  await worker.request('board.refresh')
  const launched = host.callsOf('agent.launch')[0]
  assert.equal(callString(launched, 'workspaceId'), 'w1')
  await worker.deactivate()
})

test('a project whose host cannot be named safely is left out of the scan list', async () => {
  const root = await home()
  // A registry a person edited by hand: the host here could be read as an ssh option.
  await writeFile(
    join(root, 'projects.json'),
    JSON.stringify({
      schemaVersion: 1,
      projects: [
        { name: 'safe', host: 'ssh:yolocalc', path: 'C:/work/app' },
        { name: 'unsafe', host: 'ssh:-oProxyCommand=evil', path: 'C:/work/other' }
      ]
    }),
    'utf8'
  )
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
  // The list the agent reads names the projects to scan, and the agent runs `ssh -- <target> …`
  // with that host: a name a shell could read as an option must not be in it.
  const list = JSON.parse(await readFile(join(root, 'scan-list.json'), 'utf8'))
  const projects: unknown = list.projects
  const hosts = Array.isArray(projects)
    ? projects.filter(isRecord).map((project) => project['host'])
    : []
  assert.deepEqual(hosts, ['ssh:yolocalc'])
  await worker.deactivate()
})

test('the scan list names the project of a paired Orca server, with its host', async () => {
  const root = await home()
  const host = mockHost({
    results: {
      'workspace.list': {
        workspaces: [
          workspaces.workspaces[0],
          {
            id: 'wt-remote-1::D:/ctjt/code/ctjt-platform/ctjt-service',
            kind: 'worktree',
            name: 'ctjt-service',
            project: 'ctjt-service',
            projectId: 'repo-remote-1',
            path: 'D:/ctjt/code/ctjt-platform/ctjt-service',
            branch: 'main',
            hostId: 'runtime:db289643-131b-44b3-be01-eac5b5410e48'
          }
        ],
        truncated: false
      },
      'project.list': {
        projects: [
          {
            id: 'repo-remote-1',
            name: 'ctjt-service',
            kind: 'git',
            hostId: 'runtime:db289643-131b-44b3-be01-eac5b5410e48',
            path: 'D:/ctjt/code/ctjt-platform/ctjt-service',
            hidden: false
          }
        ],
        truncated: false
      },
      'workspace.readContext': null,
      'agent.launch': { terminalId: 't9' }
    }
  })
  const worker = await mountWorker(main, { host })
  await worker.request('board.refresh')
  // The agent reads this list and scans every project in it: the one on the paired server is in
  // it, under the host id that server is reached by — the agent turns that id into an ssh name.
  const list = JSON.parse(await readFile(join(root, 'scan-list.json'), 'utf8'))
  const projects: unknown = list.projects
  const remote = Array.isArray(projects)
    ? projects.filter(isRecord).find((project) => project['path'] === 'D:/ctjt/code/ctjt-platform/ctjt-service')
    : undefined
  assert.ok(remote)
  assert.equal(remote['host'], 'runtime:db289643-131b-44b3-be01-eac5b5410e48')
  assert.equal(remote['name'], 'ctjt-service')
  await worker.deactivate()
})

test('the scan list tells the agent where the progress file is', async () => {
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
  // The prompt has no room for the shape of the progress file, so it travels with the list the
  // agent reads anyway: the agent is told where to write and what to write there.
  const list = JSON.parse(await readFile(join(root, 'scan-list.json'), 'utf8'))
  const progress = list.progress
  assert.ok(isRecord(progress))
  assert.equal(progress['path'], join(root, 'progress.json'))
  assert.equal(progress['afterEachProject'], '每扫完一个项目就写一次')
  await worker.deactivate()
})

test('the progress the agent wrote is what the worker answers', async () => {
  const root = await home()
  await writeFile(
    join(root, 'progress.json'),
    JSON.stringify({ done: 2, total: 5, current: 'ctjt-service' }),
    'utf8'
  )
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  const answer = await worker.request('board.progress')
  assert.deepEqual(answer.progress, { done: 2, total: 5, current: 'ctjt-service' })
  await worker.deactivate()
})

test('a progress that is not one is no progress', async () => {
  const root = await home()
  // The agent is an LLM: a file it wrote may hold anything. A progress the panel cannot read is
  // no progress — the bar says nothing rather than something false.
  await writeFile(join(root, 'progress.json'), '{ not json', 'utf8')
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  assert.equal((await worker.request('board.progress')).progress, null)
  await worker.deactivate()
})

test('a refresh takes the last refresh’s progress away', async () => {
  const root = await home()
  await writeFile(
    join(root, 'progress.json'),
    JSON.stringify({ done: 4, total: 5, current: 'ctjt-service' }),
    'utf8'
  )
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
  // The progress belongs to the refresh that is starting: a bar counting the last run's projects
  // would say the agent is halfway when it has not begun.
  assert.equal((await worker.request('board.progress')).progress, null)
  await worker.deactivate()
})

test('a refresh that cannot write its prompt is refused with a message', async () => {
  const root = await home()
  // The store directory points inside a file, so neither it nor the prompt file can exist.
  const blocker = join(root, 'blocker')
  await writeFile(blocker, 'x', 'utf8')
  process.env.SPEC_BOARD_HOME = join(blocker, 'store')
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
  // The panel is handed a code it knows and a message that names the reason, not a raw errno.
  await assert.rejects(worker.request('board.refresh'), (error: unknown) => {
    return (
      errorCode(error) === 'unavailable' &&
      error instanceof Error &&
      error.message.includes('last-refresh-prompt.md')
    )
  })
  assert.deepEqual(host.callsOf('agent.launch'), [])
  await worker.deactivate()
})

