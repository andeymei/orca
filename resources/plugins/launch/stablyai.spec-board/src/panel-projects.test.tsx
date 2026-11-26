// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
// The 项目 tab: the project cards, the refresh button, and what a project says when it failed.
import { assert, hostError, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import { fixturePayload } from './panel-fixture'
import type { BoardPayload, SnapshotProject } from './model'

/** A project with both frameworks and the OpenSpec CLI. */
const repo: SnapshotProject = {
  id: 'local|/repo',
  name: 'repo',
  host: 'local',
  path: '/repo',
  openspec: { present: true, capabilities: [], activeChanges: 3, archived: 0 },
  superpowers: { present: true, specs: 1, plans: 1 },
  openspecCli: { available: true },
  scannedAt: '2026-11-25T10:00:00.000Z'
}

/** A project without Superpowers and without the CLI. */
const legacy: SnapshotProject = {
  id: 'local|/legacy',
  name: 'legacy',
  host: 'local',
  path: '/legacy',
  openspec: { present: true, capabilities: [], activeChanges: 1, archived: 0 },
  superpowers: null,
  openspecCli: { available: false },
  scannedAt: '2026-11-25T10:00:00.000Z'
}

/** A project on another host that the agent did not cover: nobody checked it. */
const remote: SnapshotProject = {
  id: 'ssh:yolo|C:/work/app',
  name: 'app',
  host: 'ssh:yolo',
  path: 'C:/work/app',
  openspec: null,
  superpowers: null,
  openspecCli: null,
  scannedAt: '2026-11-25T10:00:00.000Z'
}

/** The board the projects tab is drawn against. */
function boardWith(projects: readonly SnapshotProject[]): BoardPayload {
  return {
    items: [],
    projects: [...projects],
    focus: null,
    sources: { localAt: 1, agentAt: null },
    warnings: []
  }
}

/** The panel, on the projects tab. */
async function projectsTab(payload: BoardPayload) {
  const host = mockHost({ requests: { 'board.get': () => payload } })
  const view = await mount(panel, { host })
  await view.select({ label: '看板视图' }, 'projects')
  return view
}

/** One turn of the event loop, so the panel can draw what a press started. */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

test('a project card says what the project is and what it carries', async () => {
  const view = await projectsTab(boardWith([repo]))
  assert.ok(view.find({ type: 'Badge', text: 'repo · local' }))
  assert.ok(view.find({ type: 'Badge', text: 'OpenSpec' }))
  assert.ok(view.find({ type: 'Badge', text: 'Superpowers' }))
  assert.ok(view.find({ type: 'Badge', text: 'CLI 可用' }))
  // The scan time is how long ago, not a wall clock the reader has to compare.
  assert.equal(
    view.find({ type: 'RelativeTime' })?.props.at,
    Date.parse('2026-11-25T10:00:00.000Z')
  )
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
  await view.unmount()
})

test('a project without a framework or a CLI says so', async () => {
  const view = await projectsTab(boardWith([legacy]))
  assert.ok(view.find({ type: 'Badge', text: '无 Superpowers' }))
  assert.ok(view.find({ type: 'Badge', text: '无 CLI' }))
  assert.equal(view.find({ type: 'Badge', text: 'CLI 可用' }), null)
  await view.unmount()
})

test('a project whose CLI nobody could probe says so', async () => {
  // The worker cannot run the probe on another host: it does not know, and it does not say the
  // CLI is missing.
  const view = await projectsTab(boardWith([{ ...repo, openspecCli: null }]))
  assert.ok(view.find({ type: 'Badge', text: 'CLI 未知' }))
  assert.equal(view.find({ type: 'Badge', text: '无 CLI' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a project nobody scanned says so', async () => {
  const view = await projectsTab(boardWith([{ ...repo, scannedAt: '' }]))
  assert.ok(view.find({ text: '尚未扫描' }))
  assert.equal(view.find({ type: 'RelativeTime' }), null)
  await view.unmount()
})

test('a project with a time that is not ISO says so instead of throwing', async () => {
  const unreadable = await projectsTab(boardWith([{ ...repo, scannedAt: 'not-a-time' }]))
  assert.ok(unreadable.find({ text: '未知时间' }))
  assert.equal(unreadable.find({ type: 'RelativeTime' }), null)
  assert.deepEqual(unreadable.errors, [])
  await unreadable.unmount()

  // A value a date parser accepts but no snapshot writes is not a time either.
  const loose = await projectsTab(boardWith([{ ...repo, scannedAt: '2026' }]))
  assert.ok(loose.find({ text: '未知时间' }))
  assert.equal(loose.find({ type: 'RelativeTime' }), null)
  await loose.unmount()
})

test('a project that failed to scan wears the error, and the others render as usual', async () => {
  const failure = '路径不可读：/legacy（ENOENT）'
  const view = await projectsTab(boardWith([repo, { ...legacy, error: failure }]))
  assert.ok(view.find({ type: 'Badge', text: failure }))
  // The project that did scan still says what it carries.
  assert.ok(view.find({ type: 'Badge', text: 'repo · local' }))
  assert.equal(view.findAll({ type: 'Card' }).length, 2)
  await view.unmount()
})

test('a failure is reported once: on the project, not on the board', async () => {
  const failure = '路径不可读：/legacy（ENOENT）'
  const view = await projectsTab(boardWith([{ ...legacy, error: failure }]))
  // The card's badge is the only place the failure is read.
  assert.equal(view.findAll({ text: failure }).length, 1)
  // The board has nothing to warn about: the failure is the project's alone.
  assert.equal(view.find({ type: 'Callout' }), null)
  await view.unmount()
})

test('the tab says so when the board knows no project', async () => {
  const view = await projectsTab(boardWith([]))
  assert.ok(view.find({ type: 'EmptyState' }))
  assert.equal(view.find({ type: 'Card' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('the tab says the list is local while the agent has collected nothing', async () => {
  const view = await projectsTab({
    ...boardWith([repo]),
    sources: { localAt: 1, agentAt: null }
  })
  // The list is the local scan's, and the remote projects are not in it.
  assert.ok(view.find({ text: '尚无 agent 快照（项目清单来自本地扫描）' }))
  await view.unmount()
})

test('the tab says nothing of the sort once the agent has collected', async () => {
  const view = await projectsTab({
    ...boardWith([repo]),
    sources: { localAt: 1, agentAt: 1 }
  })
  assert.equal(view.find({ text: '尚无 agent 快照（项目清单来自本地扫描）' }), null)
  await view.unmount()
})

test('a project on another host says nobody checked it', async () => {
  const view = await projectsTab(boardWith([remote]))
  // The worker cannot read a remote project, so an empty field is an absence nobody looked for.
  assert.ok(view.find({ type: 'Badge', text: '未知 OpenSpec' }))
  assert.ok(view.find({ type: 'Badge', text: '未知 Superpowers' }))
  assert.ok(view.find({ type: 'Badge', text: 'CLI 未知' }))
  await view.unmount()
})

test('a remote project the agent covered says what it has', async () => {
  const view = await projectsTab(
    boardWith([
      {
        ...remote,
        openspec: { present: false, capabilities: [], activeChanges: 0, archived: 0 },
        superpowers: { present: true, specs: 2, plans: 1 },
        openspecCli: { available: true }
      }
    ])
  )
  assert.ok(view.find({ type: 'Badge', text: '无 OpenSpec' }))
  assert.ok(view.find({ type: 'Badge', text: 'Superpowers' }))
  assert.ok(view.find({ type: 'Badge', text: 'CLI 可用' }))
  assert.equal(view.find({ type: 'Badge', text: '未知 OpenSpec' }), null)
  await view.unmount()
})

test('a project whose scan failed says nobody checked it', async () => {
  const view = await projectsTab(
    boardWith([
      {
        ...repo,
        openspec: null,
        superpowers: null,
        scannedAt: '',
        error: '路径不可读：/repo（ENOENT）'
      }
    ])
  )
  // The scan did not happen, so the project has no scan time and no framework facts.
  assert.ok(view.find({ text: '尚未扫描' }))
  assert.ok(view.find({ type: 'Badge', text: '未知 OpenSpec' }))
  assert.ok(view.find({ type: 'Badge', text: '未知 Superpowers' }))
  await view.unmount()
})

test('a project with an empty error wears no badge', async () => {
  const view = await projectsTab(boardWith([{ ...repo, error: '' }]))
  // An empty error is no error at all: the project was read.
  assert.equal(
    view.findAll({ type: 'Badge' }).filter((badge) => badge.props.tone === 'danger').length,
    0
  )
  assert.ok(view.find({ type: 'Badge', text: 'OpenSpec' }))
  await view.unmount()
})

test('a project on a runtime host says it needs the agent', async () => {
  const view = await projectsTab(
    boardWith([{ ...remote, id: 'runtime:env-1|/x', host: 'runtime:env-1' }])
  )
  // v1 does not support runtime hosts: the card says so instead of failing quietly.
  assert.ok(view.find({ type: 'Badge', text: '需 agent 采集' }))
  await view.unmount()
})

test('a scan time without a zone is read as UTC', async () => {
  const view = await projectsTab(boardWith([{ ...repo, scannedAt: '2026-11-25T10:00:00' }]))
  // The snapshot is written by an agent, on a machine whose zone is not the reader's.
  assert.equal(
    view.find({ type: 'RelativeTime' })?.props.at,
    Date.parse('2026-11-25T10:00:00Z')
  )
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('the panel reopens on the tab it was left on', async () => {
  const host = mockHost({ requests: { 'board.get': () => boardWith([repo]) } })
  const view = await mount(panel, {
    host,
    persisted: { plugin: { 'spec-board.tab': 'projects' } }
  })
  // This is how the plugin's own check opens the 项目 tab.
  assert.ok(view.find({ type: 'Button', text: '刷新' }))
  assert.equal(view.find({ text: 'Add X' }), null)
  await view.unmount()
})

test('a stored tab that names no tab falls back to the board', async () => {
  const host = mockHost({ requests: { 'board.get': () => fixturePayload } })
  const view = await mount(panel, {
    host,
    persisted: { plugin: { 'spec-board.tab': 'nowhere' } }
  })
  // The tab bar is told a tab it knows: a stored value that names no tab would show nothing.
  assert.equal(view.find({ type: 'Tabs' })?.props.value, 'board')
  assert.ok(view.find({ text: 'Add X' }))
  assert.equal(view.find({ type: 'Button', text: '刷新' }), null)
  await view.unmount()
})

test('the tab says the board is not read yet when the read fails', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => {
        throw hostError('timeout', '读取超时')
      }
    }
  })
  const view = await mount(panel, { host })
  await view.select({ label: '看板视图' }, 'projects')
  assert.ok(view.find({ text: '还没有读到看板。' }))
  assert.equal(view.find({ type: 'EmptyState' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('the refresh button asks the worker, and says who took it', async () => {
  const releases: (() => void)[] = []
  const host = mockHost({
    requests: {
      'board.get': () => boardWith([repo]),
      'board.refresh': () =>
        new Promise((resolve) => {
          releases.push(() => resolve({ terminalId: 't1', agent: 'claude' }))
        })
    }
  })
  const view = await mount(panel, { host })
  await view.select({ label: '看板视图' }, 'projects')
  assert.ok(view.find({ type: 'Button', text: '刷新' }))

  const pressing = view.press({ text: '刷新' })
  await tick()
  // The request is in flight: the button says so and cannot be pressed again.
  const waiting = view.find({ type: 'Button', text: '刷新中…' })
  assert.ok(waiting)
  assert.equal(waiting?.props.disabled, true)

  releases[0]?.()
  await pressing
  assert.equal(view.find({ type: 'Button', text: '刷新中…' }), null)
  assert.ok(view.find({ type: 'Button', text: '刷新' }))
  assert.ok(view.find({ text: '已派发 claude 刷新' }))

  // A second refresh takes the last answer away: the button says it is running again.
  const again = view.press({ text: '刷新' })
  await tick()
  assert.equal(view.find({ text: '已派发 claude 刷新' }), null)
  assert.ok(view.find({ type: 'Button', text: '刷新中…' }))
  releases[1]?.()
  await again
  assert.ok(view.find({ text: '已派发 claude 刷新' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a refresh that names no agent says that one took it', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => boardWith([repo]),
      'board.refresh': () => ({ terminalId: 't1' })
    }
  })
  const view = await mount(panel, { host })
  await view.select({ label: '看板视图' }, 'projects')
  await view.press({ text: '刷新' })
  assert.ok(view.find({ text: '已派发 agent 刷新' }))
  await view.unmount()
})

test('a refused refresh says so, and the button asks again', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => boardWith([repo]),
      'board.refresh': () => {
        throw hostError('not_permitted', '能力未批准')
      }
    }
  })
  const view = await mount(panel, { host })
  await view.select({ label: '看板视图' }, 'projects')
  await view.press({ text: '刷新' })
  assert.ok(view.find({ label: 'not_permitted' }))
  assert.ok(view.find({ text: '能力未批准' }))
  // The button is not stuck: the next press asks again.
  assert.ok(view.find({ type: 'Button', text: '刷新' }))
  assert.equal(view.find({ type: 'Button', text: '刷新中…' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
