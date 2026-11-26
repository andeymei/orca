// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
// The shell and the board tab: the stage rail, the reads, and the three tabs.
import { assert, hostError, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import { fixturePayload } from './panel-fixture'
import type { BoardPayload } from './model'

/** The board as it looked a moment ago: the first card has another name. */
function boardTitled(title: string): BoardPayload {
  return {
    ...fixturePayload,
    items: fixturePayload.items.map((item, index) =>
      index === 0 ? { ...item, title } : item
    )
  }
}

test('counts the work in every stage and marks the stage the rail is on', async () => {
  const host = mockHost({ requests: { 'board.get': () => fixturePayload } })
  const view = await mount(panel, { host })
  const selected = view.find({ type: 'Button', text: '实现 3' })
  assert.ok(selected)
  assert.equal(selected?.props.variant, 'solid')
  const other = view.find({ type: 'Button', text: '提案 0' })
  assert.ok(other)
  assert.equal(other?.props.variant, 'ghost')
  await view.unmount()
})

test('says when the stage has no work', async () => {
  const host = mockHost({ requests: { 'board.get': () => fixturePayload } })
  const view = await mount(panel, { host })
  await view.press({ type: 'Button', text: '提案 0' })
  assert.ok(view.find({ type: 'EmptyState' }))
  assert.equal(view.find({ text: 'Add X' }), null)
  await view.unmount()
})

test('the warnings are above the tabs, so every tab shows them', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => ({ ...fixturePayload, warnings: ['board.json: schemaVersion: 期望 1'] })
    }
  })
  const view = await mount(panel, { host })
  const callout = view.find({ type: 'Callout' })
  assert.ok(callout)
  assert.equal(callout?.props.tone, 'warning')
  // The warning is said once: the shell carries it, the tabs do not repeat it.
  assert.equal(view.findAll({ text: 'board.json: schemaVersion: 期望 1' }).length, 1)
  // The map is open now, and the warning is still there: a broken snapshot is not a problem of
  // one tab.
  await view.select({ label: '看板视图' }, 'map')
  assert.ok(view.find({ type: 'Callout' }))
  assert.equal(view.findAll({ text: 'board.json: schemaVersion: 期望 1' }).length, 1)
  // And the 项目 tab, which is the tab the requirement is most about.
  await view.select({ label: '看板视图' }, 'projects')
  assert.ok(view.find({ type: 'Callout' }))
  assert.equal(view.findAll({ text: 'board.json: schemaVersion: 期望 1' }).length, 1)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('the error card names the last snapshot that parsed', async () => {
  const at = Date.parse('2026-11-25T09:00:00.000Z')
  const host = mockHost({
    requests: {
      'board.get': () => ({
        ...fixturePayload,
        sources: { localAt: 1, agentAt: at },
        warnings: ['快照不是合法的 JSON：/home/x/.orca/spec-board/board.json（Unexpected token）']
      })
    }
  })
  const view = await mount(panel, { host })
  // The card names the file and the parse error; it also says how old the good data is.
  assert.ok(view.find({ text: '快照不是合法的 JSON：/home/x/.orca/spec-board/board.json（Unexpected token）' }))
  assert.ok(view.find({ text: '上次有效时间' }))
  assert.equal(view.find({ type: 'RelativeTime' })?.props.at, at)
  await view.unmount()
})

test('the error card says nothing about a last time when there is none', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => ({
        ...fixturePayload,
        sources: { localAt: 1, agentAt: null },
        warnings: ['快照不是合法的 JSON：/home/x/.orca/spec-board/board.json（Unexpected token）']
      })
    }
  })
  const view = await mount(panel, { host })
  assert.equal(view.find({ text: '上次有效时间' }), null)
  assert.equal(view.find({ type: 'RelativeTime' }), null)
  await view.unmount()
})

test('a refresh does not wipe the failure of a board read', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => {
        throw hostError('timeout', '读取超时')
      },
      'board.refresh': () => ({ terminalId: 't1', agent: 'claude' })
    }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ label: 'timeout' }))
  await view.select({ label: '看板视图' }, 'projects')
  await view.press({ text: '刷新' })
  // The board is still unread: the refresh launches an agent, it does not read the board.
  assert.ok(view.find({ label: 'timeout' }))
  assert.ok(view.find({ text: '读取超时' }))
  await view.unmount()
})

test('a refused refresh does not hide the failure of a board read', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => {
        throw hostError('timeout', '读取超时')
      },
      'board.refresh': () => {
        throw hostError('not_permitted', '能力未批准')
      }
    }
  })
  const view = await mount(panel, { host })
  await view.select({ label: '看板视图' }, 'projects')
  await view.press({ text: '刷新' })
  // Two failures, two cards: the read that failed and the refresh that failed.
  assert.ok(view.find({ label: 'timeout' }))
  assert.ok(view.find({ text: '读取超时' }))
  assert.ok(view.find({ label: 'not_permitted' }))
  assert.ok(view.find({ text: '能力未批准' }))
  await view.unmount()
})

test('the refresh draws a bar that moves with the agent’s progress', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'board.refresh': () => ({ terminalId: 't1', agent: 'claude' })
    }
  })
  const view = await mount(panel, { host })
  await view.select({ label: '看板视图' }, 'projects')
  await view.press({ text: '刷新' })
  await view.settled()
  // The agent has not said anything yet: the bar is there, and it claims no number.
  assert.ok(view.find({ type: 'Progress' }))
  assert.equal(view.find({ type: 'Progress' })?.props.value, undefined)
  assert.ok(view.find({ text: 'agent 正在采集' }))
  // The agent reports: the bar takes the number the agent gave, and names the project it is on.
  await view.post('board.progress.changed', {
    progress: { done: 2, total: 5, current: 'ctjt-service' }
  })
  await view.settled()
  assert.ok(view.find({ text: '已采集 2/5 个项目' }))
  assert.ok(view.find({ text: '正在采集 ctjt-service' }))
  assert.equal(view.find({ type: 'Progress' })?.props.value, 40)
  await view.unmount()
})

test('the bar is above the tabs, so every tab shows the refresh', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'board.refresh': () => ({ terminalId: 't1', agent: 'claude' })
    }
  })
  const view = await mount(panel, { host })
  await view.select({ label: '看板视图' }, 'projects')
  await view.press({ text: '刷新' })
  await view.settled()
  assert.ok(view.find({ type: 'Progress' }))
  // The refresh is the whole board's, not one tab's: the bar stays where the person can see it.
  await view.select({ label: '看板视图' }, 'board')
  assert.ok(view.find({ type: 'Progress' }))
  await view.unmount()
})

test('a board with nothing of its own shows the warnings as a danger, not a note', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => ({
        items: [],
        projects: [],
        focus: null,
        sources: { localAt: null, agentAt: null },
        warnings: ['board.json: schemaVersion: 期望 1']
      })
    }
  })
  const view = await mount(panel, { host })
  // Without a local scan the board has nothing to show, so the warnings are the reason it is
  // empty rather than a note about it.
  assert.equal(view.find({ type: 'Callout' })?.props.tone, 'danger')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a refused action and the board warnings are two different callouts', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => ({ ...fixturePayload, warnings: ['board.json: schemaVersion: 期望 1'] }),
      'action.run': () => {
        throw hostError('not_permitted', '能力未批准')
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: '校验' })
  // One card is about the refused request, the other about the data.
  assert.equal(view.findAll({ type: 'Callout' }).length, 2)
  assert.ok(view.find({ label: 'not_permitted' }))
  assert.ok(view.find({ text: '能力未批准' }))
  await view.unmount()
})

test('shows what the host refused when the board cannot be read', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => {
        throw hostError('timeout', '读取超时')
      }
    }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ label: 'timeout' }))
  assert.ok(view.find({ text: '读取超时' }))
  assert.ok(view.find({ text: '还没有读到看板。' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('reads the board again when the worker says it changed', async () => {
  let reads = 0
  const host = mockHost({
    requests: {
      'board.get': () => {
        reads += 1
        return fixturePayload
      }
    }
  })
  const view = await mount(panel, { host })
  assert.equal(reads, 1)

  await view.post('board.changed', { agentAt: 1 })
  assert.equal(reads, 2)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('an older read does not overwrite a newer board', async () => {
  const titles = ['First board', 'Stale board', 'Fresh board']
  let call = 0
  const host = mockHost({
    requests: {
      'board.get': () => {
        call += 1
        const title = titles[call - 1]
        // The second read answers last, and its answer is the older one.
        const delay = call === 2 ? 40 : 0
        return new Promise((resolve) => {
          setTimeout(() => resolve(boardTitled(title)), delay)
        })
      }
    }
  })
  const view = await mount(panel, { host })
  const first = view.post('board.changed', { agentAt: 1 })
  const second = view.post('board.changed', { agentAt: 2 })
  await Promise.all([first, second])
  await view.settled()
  assert.ok(view.find({ text: 'Fresh board' }))
  assert.equal(view.find({ text: 'Stale board' }), null)
  await view.unmount()
})

test('a hung read does not leave the next panel busy', async () => {
  let calls = 0
  const first = await mount(panel, {
    host: mockHost({
      requests: {
        'board.get': () => {
          calls += 1
          if (calls === 1) {
            return fixturePayload
          }
          // This read never comes back.
          return new Promise<BoardPayload>(() => {})
        }
      }
    })
  })
  void first.post('board.changed', { agentAt: 1 }).catch(() => undefined)
  await first.unmount()

  const second = await mount(panel, {
    host: mockHost({
      requests: {
        'board.get': () => {
          throw hostError('timeout', '读取超时')
        }
      }
    })
  })
  // The hung read of the panel that closed does not leave this one loading.
  assert.ok(second.find({ text: '还没有读到看板。' }))
  assert.equal(second.find({ text: '读取中…' }), null)
  await second.unmount()
})

test('a read that lands after its panel closed does not write to the board', async () => {
  const late: { answer?: (value: BoardPayload) => void } = {}
  let calls = 0
  const first = await mount(panel, {
    host: mockHost({
      requests: {
        'board.get': () => {
          calls += 1
          if (calls === 1) {
            return fixturePayload
          }
          return new Promise<BoardPayload>((resolve) => {
            late.answer = resolve
          })
        }
      }
    })
  })
  void first.post('board.changed', { agentAt: 1 }).catch(() => undefined)
  await first.unmount()

  const second = await mount(panel, {
    host: mockHost({ requests: { 'board.get': () => fixturePayload } })
  })
  assert.ok(second.find({ text: 'Add X' }))
  // The read of the panel that closed lands now; it has nothing to say to this board.
  late.answer?.(boardTitled('Stale board'))
  await second.settled()
  assert.equal(second.find({ text: 'Stale board' }), null)
  assert.ok(second.find({ text: 'Add X' }))
  await second.unmount()
})

test('the other two tabs are there', async () => {
  const host = mockHost({ requests: { 'board.get': () => fixturePayload } })
  const view = await mount(panel, { host })
  assert.ok(view.find({ type: 'Tabs' }))
  await view.select({ type: 'Tabs' }, 'map')
  // The map is drawn in its own tab, and the board's cards are not in it.
  assert.ok(view.find({ text: 'OpenSpec' }))
  assert.equal(view.find({ text: 'Add X' }), null)
  await view.unmount()
})
