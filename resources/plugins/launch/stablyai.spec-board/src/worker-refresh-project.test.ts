// The refresh of one project: a local one is read here, a remote one by an agent, and what the
// agent wrote is merged into the board's snapshot without touching the other projects.
import { afterEach, assert, mockHost, mountWorker, test, type TestWorker } from 'orca/testing'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectScanListPath, projectSnapshotPath } from './store-paths'
import { errorCode, isRecord } from './unknown-values'
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

/** A project with one OpenSpec change in it. */
async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spec-board-project-'))
  roots.push(root)
  await mkdir(join(root, 'openspec/changes/add-x'), { recursive: true })
  await writeFile(join(root, 'openspec/changes/add-x/proposal.md'), '# Change: Add X\n')
  await writeFile(join(root, 'openspec/changes/add-x/tasks.md'), '- [x] one\n- [ ] two\n')
  return root
}

/** The board's snapshot, with the given projects in it. */
function snapshotOf(projects: readonly unknown[]): string {
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt: '2026-11-25T10:00:00.000Z',
      generatedBy: { agent: 'claude' },
      projects,
      items: []
    },
    null,
    2
  )}\n`
}

/** A project as the snapshot holds it: what somebody read, and when. */
function projectFacts(id: string, name: string, host: string, path: string): unknown {
  return {
    id,
    name,
    host,
    path,
    openspec: null,
    superpowers: null,
    openspecCli: null,
    scannedAt: '2026-11-25T10:00:00.000Z'
  }
}

/** The workspace the agent runs in. */
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
    }
  ],
  truncated: false
}

/** The registry the person edited: it names the projects to scan. */
async function registry(projects: readonly { name: string; host: string; path: string }[]) {
  const store = await home()
  await writeFile(
    join(store, 'projects.json'),
    JSON.stringify({ schemaVersion: 1, projects }),
    'utf8'
  )
  return store
}

/**
 * Writes what the agent writes: a temporary file, then renamed over the real one.
 *
 * The watcher only learns the name of a file from the rename — a plain write tells it the
 * directory's name, not the file's — so a test that writes the file directly would wait for a
 * merge that the watcher never hears about.
 */
async function writeAgentFile(path: string, content: string): Promise<void> {
  const temporary = `${path}.tmp`
  await writeFile(temporary, content, 'utf8')
  await rename(temporary, path)
}

/** The projects of a written file, as the reader sees them. */
function projectsOf(raw: string): { id: string; openspec: unknown }[] {
  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed)) {
    return []
  }
  const list = parsed['projects']
  if (!Array.isArray(list)) {
    return []
  }
  return list.filter(isRecord).map((entry) => ({
    id: String(entry['id']),
    openspec: entry['openspec']
  }))
}

test('a local project is read here, and the snapshot gets what the scan found', async () => {
  const repo = await project()
  const store = await registry([{ name: 'demo', host: 'local', path: repo }])
  await writeFile(
    join(store, 'board.json'),
    snapshotOf([
      projectFacts(`local|${repo}`, 'demo', 'local', repo),
      projectFacts('ssh:yolo|C:/work/app', 'app', 'ssh:yolo', 'C:/work/app')
    ]),
    'utf8'
  )
  const host = mockHost({
    results: {
      'workspace.list': { workspaces: [], truncated: false },
      'workspace.readContext': null,
      'agent.launch': { terminalId: 't9' }
    }
  })
  const worker = await mountWorker(main, { host })
  const answer = await worker.request('board.refreshProject', { projectId: `local|${repo}` })
  assert.equal(answer.kind, 'local')
  // The worker read the project itself: no agent was launched, and no terminal opened.
  assert.deepEqual(host.callsOf('agent.launch'), [])

  const projects = projectsOf(await readFile(join(store, 'board.json'), 'utf8'))
  assert.equal(projects.length, 2)
  const fresh = projects.find((entry) => entry.id === `local|${repo}`)
  assert.ok(isRecord(fresh?.openspec))
  assert.equal(fresh?.openspec['present'], true)
  assert.equal(fresh?.openspec['activeChanges'], 1)
  // The other project is not this scan's business.
  const other = projects.find((entry) => entry.id === 'ssh:yolo|C:/work/app')
  assert.equal(other?.openspec, null)
  await worker.deactivate()
})

test('a remote project is collected by an agent that is told to scan only it', async () => {
  const projectId = 'ssh:yolo|C:/work/app'
  const store = await registry([{ name: 'app', host: 'ssh:yolo', path: 'C:/work/app' }])
  const host = mockHost({
    results: {
      'workspace.list': workspaces,
      'workspace.readContext': null,
      'agent.launch': { terminalId: 't9' }
    }
  })
  const worker = await mountWorker(main, { host })
  const answer = await worker.request('board.refreshProject', { projectId })
  assert.equal(answer.kind, 'agent')
  assert.equal(answer.agent, 'claude')

  // The list the agent reads holds this one project and nothing else.
  const list = JSON.parse(await readFile(projectScanListPath(projectId), 'utf8'))
  const listed = Array.isArray(list.projects) ? list.projects : []
  assert.equal(listed.length, 1)
  assert.equal(isRecord(listed[0]) ? listed[0]['host'] : null, 'ssh:yolo')
  assert.equal(isRecord(listed[0]) ? listed[0]['path'] : null, 'C:/work/app')

  // The agent writes the project's own file: the board's snapshot is the plugin's to write.
  const launched = host.callsOf('agent.launch')[0]
  const prompt = isRecord(launched) ? String(launched['prompt'] ?? '') : ''
  assert.ok(prompt.includes(projectSnapshotPath(projectId)))
  assert.equal(prompt.includes(join(store, 'board.json')), false)
  await worker.deactivate()
})

test('a project that is not on the board is refused', async () => {
  await home()
  const host = mockHost({
    results: {
      'workspace.list': { workspaces: [], truncated: false },
      'workspace.readContext': null,
      'agent.launch': { terminalId: 't9' }
    }
  })
  const worker = await mountWorker(main, { host })
  // The caller's string is never read back as a path: an id the board does not know names nothing.
  await assert.rejects(
    worker.request('board.refreshProject', { projectId: 'local|/nowhere' }),
    (error: unknown) => errorCode(error) === 'invalid_params'
  )
  assert.deepEqual(host.callsOf('agent.launch'), [])
  await worker.deactivate()
})

test('what the agent wrote for one project lands in the snapshot, and the rest stays', async () => {
  const projectId = 'ssh:yolo|C:/work/app'
  const store = await registry([{ name: 'app', host: 'ssh:yolo', path: 'C:/work/app' }])
  await writeFile(
    join(store, 'board.json'),
    snapshotOf([
      projectFacts(projectId, 'app', 'ssh:yolo', 'C:/work/app'),
      projectFacts('ssh:yolo|C:/work/other', 'other', 'ssh:yolo', 'C:/work/other')
    ]),
    'utf8'
  )
  const host = mockHost({
    results: {
      'workspace.list': workspaces,
      'workspace.readContext': null
    }
  })
  const worker = await mountWorker(main, { host })
  await writeAgentFile(
    projectSnapshotPath(projectId),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: '2026-11-27T10:00:00.000Z',
        generatedBy: { agent: 'claude' },
        projects: [
          {
            id: projectId,
            name: 'app',
            host: 'ssh:yolo',
            path: 'C:/work/app',
            openspec: { present: true, capabilities: [], activeChanges: 2, archived: 0 },
            superpowers: null,
            openspecCli: { available: true, version: '1.8.0' },
            scannedAt: '2026-11-27T10:00:00.000Z'
          }
        ],
        items: []
      },
      null,
      2
    )}\n`,
  )
  // The board is read the way the panel reads it: the read is what merges what the agent
  // wrote, so the facts arrive whether the file system said so or not.
  const merged = await waitForBoard(worker, store, (projects) => {
    const app = projects.find((entry) => entry.id === projectId)
    return isRecord(app?.openspec) ? app.openspec['activeChanges'] === 2 : false
  })
  assert.equal(merged.length, 2)
  // The project nobody re-read keeps what the snapshot said about it.
  const other = merged.find((entry) => entry.id === 'ssh:yolo|C:/work/other')
  assert.equal(other?.openspec, null)
  await worker.deactivate()
})

/**
 * Waits for the snapshot to say what the person is waiting for, asking the worker for the board.
 *
 * The read is what merges what the agent wrote: the file system does not always report what
 * changed in a watched directory, and the board does not wait for a report.
 */
async function waitForBoard(
  worker: TestWorker,
  store: string,
  done: (projects: { id: string; openspec: unknown }[]) => boolean
): Promise<{ id: string; openspec: unknown }[]> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    await worker.request('board.get')
    const projects = await readProjects(store)
    if (done(projects)) {
      return projects
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('项目快照没有并进看板的快照')
}

/** Waits for the snapshot to say what the person is waiting for. */
async function waitForProjects(
  store: string,
  done: (projects: { id: string; openspec: unknown }[]) => boolean
): Promise<{ id: string; openspec: unknown }[]> {
  // The merge waits for the file watcher, and a watcher under a busy machine is slow: the wait is
  // long enough that a build running alongside does not decide the test.
  for (let attempt = 0; attempt < 200; attempt += 1) {
    // The snapshot may not be there yet: the board has never been collected.
    const projects = await readProjects(store)
    if (done(projects)) {
      return projects
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('项目快照没有并进看板的快照')
}

/** The projects of the board's snapshot, or none while there is no snapshot. */
async function readProjects(store: string): Promise<{ id: string; openspec: unknown }[]> {
  try {
    return projectsOf(await readFile(join(store, 'board.json'), 'utf8'))
  } catch {
    return []
  }
}

test('the first project collected becomes the board snapshot itself', async () => {
  // The board has no snapshot yet — the person refreshed one project before the whole board. The
  // file the agent wrote is the snapshot then, and the projects nobody collected are not in it.
  const projectId = 'ssh:yolo|C:/work/app'
  const store = await registry([{ name: 'app', host: 'ssh:yolo', path: 'C:/work/app' }])
  const host = mockHost({
    results: {
      'workspace.list': workspaces,
      'workspace.readContext': null
    }
  })
  const worker = await mountWorker(main, { host })
  await writeAgentFile(
    projectSnapshotPath(projectId),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: '2026-11-27T10:00:00.000Z',
        generatedBy: { agent: 'claude' },
        projects: [
          {
            id: projectId,
            name: 'app',
            host: 'ssh:yolo',
            path: 'C:/work/app',
            openspec: { present: true, capabilities: [], activeChanges: 1, archived: 0 },
            superpowers: null,
            openspecCli: null,
            scannedAt: '2026-11-27T10:00:00.000Z'
          }
        ],
        items: []
      },
      null,
      2
    )}\n`,
  )
  const projects = await waitForBoard(worker, store, (list) => list.length === 1)
  assert.equal(projects[0]?.id, projectId)
  await worker.deactivate()
})

test('a local project is written into the snapshot even when there is none', async () => {
  // The board has never been collected: the refresh is the first thing that writes a snapshot,
  // and the panel says the project was refreshed.
  const repo = await project()
  const store = await registry([{ name: 'demo', host: 'local', path: repo }])
  const host = mockHost({
    results: {
      'workspace.list': { workspaces: [], truncated: false },
      'workspace.readContext': null
    }
  })
  const worker = await mountWorker(main, { host })
  const answer = await worker.request('board.refreshProject', { projectId: `local|${repo}` })
  assert.equal(answer.kind, 'local')
  const projects = projectsOf(await readFile(join(store, 'board.json'), 'utf8'))
  assert.equal(projects.length, 1)
  assert.equal(projects[0]?.id, `local|${repo}`)
  await worker.deactivate()
})

test('a fragment about another project is not put on the board', async () => {
  // The file's name is the project's own digest: an agent that wrote about a different project
  // cannot put that project on the board.
  const projectId = 'ssh:yolo|C:/work/app'
  const store = await registry([{ name: 'app', host: 'ssh:yolo', path: 'C:/work/app' }])
  await writeFile(
    join(store, 'board.json'),
    snapshotOf([projectFacts(projectId, 'app', 'ssh:yolo', 'C:/work/app')]),
    'utf8'
  )
  const host = mockHost({
    results: {
      'workspace.list': workspaces,
      'workspace.readContext': null
    }
  })
  const worker = await mountWorker(main, { host })
  // The file is named after the project the refresh asked for, but it holds another one: the
  // agent wrote about the wrong project, and the board must not take it.
  await writeAgentFile(
    projectSnapshotPath(projectId),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: '2026-11-27T10:00:00.000Z',
        generatedBy: { agent: 'claude' },
        projects: [
          {
            id: 'ssh:yolo|C:/work/other',
            name: 'other',
            host: 'ssh:yolo',
            path: 'C:/work/other',
            openspec: { present: true, capabilities: [], activeChanges: 9, archived: 0 },
            superpowers: null,
            openspecCli: null,
            scannedAt: '2026-11-27T10:00:00.000Z'
          }
        ],
        items: []
      },
      null,
      2
    )}\n`,
  )
  // The board is read, so the fragment is offered to the merge: the board must still refuse it.
  await worker.request('board.get')
  const projects = projectsOf(await readFile(join(store, 'board.json'), 'utf8'))
  // The board still holds one project: the one it had.
  assert.equal(projects.length, 1)
  assert.equal(projects[0]?.id, projectId)
  assert.equal(projects[0]?.openspec, null)
  await worker.deactivate()
})

test('a fragment that places the project somewhere else is refused', async () => {
  // The id of a project is its host and its path. A fragment whose project says another place
  // than its id does not know where it is, so it is not the project the file was written for.
  const projectId = 'ssh:yolo|C:/work/app'
  const store = await registry([{ name: 'app', host: 'ssh:yolo', path: 'C:/work/app' }])
  await writeFile(
    join(store, 'board.json'),
    snapshotOf([projectFacts(projectId, 'app', 'ssh:yolo', 'C:/work/app')]),
    'utf8'
  )
  const host = mockHost({
    results: {
      'workspace.list': workspaces,
      'workspace.readContext': null
    }
  })
  const worker = await mountWorker(main, { host })
  await writeAgentFile(
    projectSnapshotPath(projectId),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: '2026-11-27T10:00:00.000Z',
        generatedBy: { agent: 'claude' },
        projects: [
          {
            id: projectId,
            name: 'app',
            host: 'ssh:yolo',
            path: 'C:/work/somewhere-else',
            openspec: { present: true, capabilities: ['core'], activeChanges: 3, archived: 0 },
            superpowers: null,
            openspecCli: null,
            scannedAt: '2026-11-27T10:00:00.000Z'
          }
        ],
        items: []
      },
      null,
      2
    )}\n`,
  )
  await worker.request('board.get')
  const projects = projectsOf(await readFile(join(store, 'board.json'), 'utf8'))
  // The board still holds the one project it had, with no facts of the fragment's.
  assert.equal(projects.length, 1)
  assert.equal(projects[0]?.id, projectId)
  assert.equal(projects[0]?.openspec, null)
  await worker.deactivate()
})

test('a fragment left on disk is merged when the worker starts', async () => {
  const projectId = 'ssh:yolo|C:/work/app'
  const store = await registry([{ name: 'app', host: 'ssh:yolo', path: 'C:/work/app' }])
  await writeFile(
    join(store, 'board.json'),
    snapshotOf([projectFacts(projectId, 'app', 'ssh:yolo', 'C:/work/app')]),
    'utf8'
  )
  await writeAgentFile(
    projectSnapshotPath(projectId),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: '2026-11-27T10:00:00.000Z',
        generatedBy: { agent: 'claude' },
        projects: [
          {
            id: projectId,
            name: 'app',
            host: 'ssh:yolo',
            path: 'C:/work/app',
            openspec: { present: true, capabilities: [], activeChanges: 3, archived: 0 },
            superpowers: null,
            openspecCli: null,
            scannedAt: '2026-11-27T10:00:00.000Z'
          }
        ],
        items: []
      },
      null,
      2
    )}\n`,
  )
  const host = mockHost({
    results: {
      'workspace.list': workspaces,
      'workspace.readContext': null
    }
  })
  const worker = await mountWorker(main, { host })
  const projects = await waitForProjects(store, (list) => {
    const app = list.find((entry) => entry.id === projectId)
    return isRecord(app?.openspec) ? app.openspec['activeChanges'] === 3 : false
  })
  // The project's facts are the ones the fragment holds, and the board still holds one project:
  // the fragment did not add a second card for the same project.
  const app = projects.find((entry) => entry.id === projectId)
  assert.ok(isRecord(app?.openspec))
  assert.equal(app?.openspec['activeChanges'], 3)
  assert.equal(projects.filter((entry) => entry.id === projectId).length, 1)
  await worker.deactivate()
})
