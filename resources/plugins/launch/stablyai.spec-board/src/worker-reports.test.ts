// The worker: what it reports to the panel — the agent a refresh launched, and the project that
// could not be scanned.
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import { mkdtemp, rm } from 'node:fs/promises'
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
    }
  ],
  truncated: false
}

test('the refresh answer names the agent the worker launched', async () => {
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
    settings: { refreshAgent: 'codex' }
  })
  const worker = await mountWorker(main, { host })
  const answer = await worker.request('board.refresh')
  assert.equal(answer.terminalId, 't9')
  // The panel says who took the refresh, and only the worker knows: the setting can change
  // between the panel's read and the launch.
  assert.equal(answer.agent, 'codex')
  await worker.deactivate()
})

test('the refresh answer names the default agent when the setting is empty', async () => {
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
    }
  })
  const worker = await mountWorker(main, { host })
  const answer = await worker.request('board.refresh')
  assert.equal(answer.agent, 'claude')
  await worker.deactivate()
})

test('a project that cannot be scanned is reported on the project, not on the board', async () => {
  const root = await home()
  cliProbe.read = async () => ({ available: false })
  const missing = join(root, 'not-there')
  const host = mockHost({
    results: { 'workspace.list': workspaces },
    settings: { scanRoots: missing }
  })
  const worker = await mountWorker(main, { host })
  const payload = await worker.request('board.get')
  const project = payload.projects.find((entry) => entry.path === missing)
  const failure = project?.error ?? ''
  assert.notEqual(failure, '')
  // The board's own warnings are about the board: the failure is the project's alone, and the
  // two channels do not carry the same fact twice.
  assert.equal(payload.warnings.includes(failure), false)
  await worker.deactivate()
})
