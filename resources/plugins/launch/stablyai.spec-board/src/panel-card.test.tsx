// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
// One card of the board: what it says, which button it leads with, and what its buttons do.
import { assert, hostError, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import { fixturePayload } from './panel-fixture'
import type { BoardPayload, UnifiedStage, VerificationFacts } from './model'

/** 一张带验证记录的看板。 */
function withVerification(
  id: string,
  verification: VerificationFacts,
  stage: UnifiedStage = 'implement'
): BoardPayload {
  return {
    ...fixturePayload,
    items: fixturePayload.items.map((item) =>
      item.id === id
        ? { ...item, stage, superpowers: { ...item.superpowers!, verification } }
        : item
    )
  }
}

test('draws the change, both progress lanes and its gaps', async () => {
  const host = mockHost({ requests: { 'board.get': () => fixturePayload } })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: 'Add X' }))
  assert.ok(view.find({ type: 'Badge', text: 'repo · local' }))
  assert.ok(view.find({ text: 'OpenSpec 2/5' }))
  assert.ok(view.find({ text: 'Superpowers 1/8' }))
  assert.ok(view.find({ text: '有 OpenSpec 变更，没有对应的 Superpowers 设计' }))
  // The bar takes a percentage, not a fraction: two of five tasks is forty.
  assert.equal(view.find({ type: 'Progress', label: 'OpenSpec 任务进度' })?.props.value, 40)
  assert.equal(view.find({ type: 'Progress', label: 'Superpowers 计划进度' })?.props.value, 13)
  assert.equal(
    view.find({ text: '有 OpenSpec 变更，没有对应的 Superpowers 设计' })?.props.tone,
    'warning'
  )
  assert.equal(view.find({ text: '有 tasks.md，但缺少 design.md' })?.props.tone, 'neutral')
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('names the project the work belongs to', async () => {
  const host = mockHost({
    requests: { 'board.get': () => ({ ...fixturePayload, projects: [] }) }
  })
  const view = await mount(panel, { host })
  // The board does not know the project: the card still says which project it is.
  assert.ok(view.find({ type: 'Badge', text: 'local|/repo' }))
  await view.unmount()
})

test('marks only the card whose OpenSpec action runs no command', async () => {
  const host = mockHost({ requests: { 'board.get': () => fixturePayload } })
  const view = await mount(panel, { host })
  // Three cards are on the rail's stage; only the one in the project without the CLI wears it.
  assert.equal(view.findAll({ type: 'Card' }).length, 3)
  assert.equal(view.findAll({ text: '无 CLI' }).length, 1)
  await view.unmount()
})

test('leads with the action the stage waits for', async () => {
  const host = mockHost({ requests: { 'board.get': () => fixturePayload } })
  const view = await mount(panel, { host })
  // Add Z is in the implement stage, which waits for the plan to be executed.
  const preferred = view.find({ type: 'Button', text: '执行计划' })
  assert.ok(preferred)
  assert.equal(preferred?.props.variant, 'solid')
  // Add X has no Superpowers skill, so its card falls back to the first action it offers.
  const fallback = view.find({ type: 'Button', text: '校验' })
  assert.ok(fallback)
  assert.equal(fallback?.props.variant, 'solid')
  // The other action is behind 更多, so it is not on the card yet.
  assert.equal(view.find({ type: 'Button', text: '代码评审' }), null)
  await view.unmount()
})

test('the other actions are behind 更多', async () => {
  const host = mockHost({ requests: { 'board.get': () => fixturePayload } })
  const view = await mount(panel, { host })
  assert.equal(view.find({ type: 'Button', text: '归档' }), null)
  // Only the two cards that offer more than one action carry a 更多.
  assert.equal(view.findAll({ type: 'Collapsible' }).length, 2)
  await view.toggle({ label: '更多' })
  const other = view.find({ type: 'Button', text: '归档' })
  assert.ok(other)
  assert.equal(other?.props.variant, 'outline')
  await view.unmount()
})

test('a change whose tasks are all ticked leads with the archive', async () => {
  const host = mockHost({ requests: { 'board.get': () => fixturePayload } })
  const view = await mount(panel, { host })
  // Add W's tasks are all ticked, so it waits in the validate stage.
  await view.press({ text: '校验 1' })
  const archive = view.find({ type: 'Button', text: '归档' })
  assert.ok(archive)
  assert.equal(archive?.props.variant, 'solid')
  // The check that comes before it is behind 更多, where it can still be run.
  await view.toggle({ label: '更多' })
  assert.equal(view.find({ type: 'Button', text: '校验' })?.props.variant, 'outline')
  await view.unmount()
})

test('an action that is out is not sent again', async () => {
  const calls: unknown[] = []
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'action.run': (input) => {
        calls.push(input)
        return { kind: 'agent', terminalId: 't9', agent: 'claude' }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: '校验' })
  assert.equal(calls.length, 1)
  // The button says it is out, and pressing it again sends nothing: a second press would start
  // a second agent, not a second attempt at the first one.
  const sent = view.find({ type: 'Button', text: '已发出' })
  assert.ok(sent)
  assert.equal(sent?.disabled, true)
  await assert.rejects(() => view.press({ type: 'Button', text: '已发出' }))
  assert.equal(calls.length, 1)
  await view.unmount()
})

test('a read of the board lets the action be sent again', async () => {
  const calls: unknown[] = []
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'action.run': (input) => {
        calls.push(input)
        return { kind: 'agent', terminalId: 't10', agent: 'claude' }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: '校验' })
  assert.equal(calls.length, 1)
  // The board was read again, so the work may have moved on: the button is live once more.
  await view.post('board.changed', { agentAt: null })
  const again = view.find({ type: 'Button', text: '校验' })
  assert.equal(again?.disabled, false)
  await view.press({ text: '校验' })
  assert.equal(calls.length, 2)
  await view.unmount()
})

test('another action of the same card does not re-arm the one that is out', async () => {
  const calls: unknown[] = []
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'action.run': (input) => {
        calls.push(input)
        return { kind: 'agent', terminalId: 't11', agent: 'claude' }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: '校验' })
  assert.equal(calls.length, 1)
  // Another action of the same card goes out; the first one is still out.
  await view.toggle({ label: '更多' })
  await view.press({ text: '归档' })
  await view.press({ text: '确认执行？' })
  assert.equal(calls.length, 2)
  assert.equal(view.find({ type: 'Button', text: '已发出' })?.disabled, true)
  await view.unmount()
})

test('runs a non-mutating action on the first press', async () => {
  const calls: unknown[] = []
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'action.run': (input) => {
        calls.push(input)
        return { kind: 'terminal', terminalId: 't1' }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: '校验' })
  assert.deepEqual(calls, [
    { projectId: 'local|/repo', actionId: 'openspec.validate', itemId: 'local|/repo#add-x' }
  ])
  await view.unmount()
})

test('holds a mutating action until a second press', async () => {
  const calls: unknown[] = []
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'action.run': (input) => {
        calls.push(input)
        return { kind: 'agent', terminalId: 't2' }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: '执行计划' })
  assert.deepEqual(calls, [])
  await view.press({ text: '确认执行？' })
  assert.deepEqual(calls, [
    { projectId: 'local|/repo', actionId: 'superpowers.execute', itemId: 'local|/repo#add-z' }
  ])
  await view.unmount()
})

test('holds a mutating action behind 更多 until a second press', async () => {
  const calls: unknown[] = []
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'action.run': (input) => {
        calls.push(input)
        return { kind: 'terminal', terminalId: 't3' }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.toggle({ label: '更多' })
  await view.press({ text: '归档' })
  assert.deepEqual(calls, [])
  await view.press({ text: '确认执行？' })
  assert.deepEqual(calls, [
    { projectId: 'local|/repo', actionId: 'openspec.archive', itemId: 'local|/repo#add-x' }
  ])
  await view.unmount()
})

test('a mutating action never runs while another one is waiting', async () => {
  const calls: unknown[] = []
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'action.run': (input) => {
        calls.push(input)
        return { kind: 'terminal', terminalId: 't7' }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.toggle({ label: '更多' })
  await view.press({ text: '执行计划' })
  await view.press({ text: '归档' })
  // The second action asks for its own confirmation: the first one's answer is not its answer.
  assert.deepEqual(calls, [])
  assert.ok(view.find({ text: '确认执行？' }))
  await view.unmount()
})

test('says what the action did', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'action.run': () => ({ kind: 'terminal', terminalId: 't4' })
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: '校验' })
  assert.ok(view.find({ text: '已在终端打开' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('says when the action went to an agent', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'action.run': () => ({ kind: 'agent', terminalId: 't5', agent: 'claude' })
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: '看增量' })
  assert.ok(view.find({ text: '已派发给 claude' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('says that an agent took the action when the worker names none', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'action.run': () => ({ kind: 'agent', terminalId: 't5' })
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: '看增量' })
  assert.ok(view.find({ text: '已派发给 agent' }))
  await view.unmount()
})

test('shows what the host refused when an action fails', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'action.run': () => {
        throw hostError('not_permitted', '能力未批准')
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: '校验' })
  assert.ok(view.find({ label: 'not_permitted' }))
  assert.ok(view.find({ text: '能力未批准' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a later action clears the failure of the last one', async () => {
  let refused = true
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'action.run': () => {
        if (refused) {
          throw hostError('not_permitted', '能力未批准')
        }
        return { kind: 'agent', terminalId: 't6' }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: '校验' })
  assert.ok(view.find({ text: '能力未批准' }))
  refused = false
  await view.press({ text: '看增量' })
  assert.equal(view.find({ text: '能力未批准' }), null)
  await view.unmount()
})

test('the next action is a hint, not a button', async () => {
  const host = mockHost({ requests: { 'board.get': () => fixturePayload } })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: '写下设计' }))
  assert.ok(view.find({ text: '先写设计 spec，再改代码' }))
  assert.equal(view.find({ type: 'Button', text: '写下设计' }), null)
  await view.unmount()
})

test('the title opens the file the work was written in', async () => {
  const calls: unknown[] = []
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'source.open': (input) => {
        calls.push(input)
        return { opened: true }
      }
    }
  })
  const view = await mount(panel, { host })
  // The title is the work item's main file: the first of the files it was written in.
  assert.ok(view.find({ type: 'Link', text: 'Add X' }))
  await view.press({ type: 'Link', text: 'Add X' })
  assert.deepEqual(calls, [{ itemId: 'local|/repo#add-x', sourceKey: 'openspec-proposal' }])
  await view.unmount()
})

test('the other files of the work are named under the title', async () => {
  const calls: unknown[] = []
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'source.open': (input) => {
        calls.push(input)
        return { opened: true }
      }
    }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ type: 'Link', text: 'design.md' }))
  assert.ok(view.find({ type: 'Link', text: 'tasks.md' }))
  await view.press({ type: 'Link', text: 'tasks.md' })
  assert.deepEqual(calls, [{ itemId: 'local|/repo#add-x', sourceKey: 'openspec-tasks' }])
  await view.unmount()
})

test('a work item with no file to open keeps its plain title', async () => {
  const board: BoardPayload = {
    ...fixturePayload,
    items: fixturePayload.items.map((item) =>
      item.id === 'local|/repo#add-x' ? { ...item, sources: [] } : item
    )
  }
  const host = mockHost({ requests: { 'board.get': () => board } })
  const view = await mount(panel, { host })
  // A link that opens nothing is worse than no link: the title stays plain text.
  assert.equal(view.find({ type: 'Link', text: 'Add X' }), null)
  assert.ok(view.find({ type: 'Text', text: 'Add X' }))
  await view.unmount()
})

test('says what could not be opened', async () => {
  const host = mockHost({
    requests: {
      'board.get': () => fixturePayload,
      'source.open': () => {
        throw hostError('invalid_params', '这个工作项没有这个文件')
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ type: 'Link', text: 'Add X' })
  assert.ok(view.find({ label: 'invalid_params' }))
  assert.ok(view.find({ text: '这个工作项没有这个文件' }))
  await view.unmount()
})

test('the actions of a project without a workspace are off, and they say why', async () => {
  const calls: unknown[] = []
  const board: BoardPayload = {
    ...fixturePayload,
    projects: fixturePayload.projects.map((project) =>
      project.id === 'local|/repo' ? { ...project, canRun: false } : project
    )
  }
  const host = mockHost({
    requests: {
      'board.get': () => board,
      'action.run': (input) => {
        calls.push(input)
        return { kind: 'terminal', terminalId: 't8' }
      }
    }
  })
  const view = await mount(panel, { host })
  const button = view.find({ type: 'Button', text: '校验' })
  assert.equal(button?.disabled, true)
  assert.equal(button?.props.tooltip, '该项目不在 Orca workspace 里')
  // The button is the notice: nothing runs.
  await assert.rejects(() => view.press({ type: 'Button', text: '校验' }))
  assert.deepEqual(calls, [])
  // The other project still has a workspace, so its card still works.
  assert.equal(view.find({ type: 'Button', text: '看增量' })?.disabled, false)
  await view.unmount()
})

test('最近一轮通过，卡片说它被验证过几轮', async () => {
  const host = mockHost({
    requests: {
      'board.get': () =>
        withVerification('local|/repo#add-z', { rounds: 2, passed: 1, lastPassed: true }, 'verified')
    }
  })
  const view = await mount(panel, { host })
  // 卡片在「已验证」那一栏里。
  await view.press({ type: 'Button', text: '已验证 1' })
  const badge = view.find({ type: 'Badge', text: '已验证 ×1' })
  assert.ok(badge)
  assert.equal(badge?.props.tone, 'success')
  await view.unmount()
})

test('卡片不在「已验证」，就不戴成功的徽标', async () => {
  // 验证过了又加了新任务，卡片退回「实现」：它没有再被验证过，戴着「已验证」就是撒谎。
  const host = mockHost({
    requests: {
      'board.get': () =>
        withVerification('local|/repo#add-z', { rounds: 2, passed: 2, lastPassed: true }, 'implement')
    }
  })
  const view = await mount(panel, { host })
  // 卡片画出来了，它只是不戴那个徽标。
  assert.ok(view.find({ text: 'Add Z' }))
  assert.equal(view.find({ type: 'Badge', text: '已验证 ×2' }), null)
  await view.unmount()
})

test('最近一轮没过，卡片说的是没通过', async () => {
  const host = mockHost({
    requests: {
      'board.get': () =>
        withVerification('local|/repo#add-z', { rounds: 2, passed: 1, lastPassed: false })
    }
  })
  const view = await mount(panel, { host })
  const badge = view.find({ type: 'Badge', text: '上次验证未通过' })
  assert.ok(badge)
  assert.equal(badge?.props.tone, 'warning')
  await view.unmount()
})

test('没有记录就不戴验证徽标', async () => {
  const host = mockHost({ requests: { 'board.get': () => fixturePayload } })
  const view = await mount(panel, { host })
  assert.equal(view.find({ type: 'Badge', text: '已验证 ×1' }), null)
  assert.equal(view.find({ type: 'Badge', text: '上次验证未通过' }), null)
  await view.unmount()
})

test('记录里没有结论，卡片就不说话', async () => {
  const host = mockHost({
    requests: {
      'board.get': () =>
        withVerification('local|/repo#add-z', { rounds: 2, passed: 1, lastPassed: null })
    }
  })
  const view = await mount(panel, { host })
  // A record with rounds but no verdict is no evidence: neither badge is drawn.
  assert.equal(view.find({ type: 'Badge', text: '已验证 ×1' }), null)
  assert.equal(view.find({ type: 'Badge', text: '上次验证未通过' }), null)
  // Asking for the texts would miss an empty badge, so ask for the count: the board still wears
  // its seven badges — three project lines, 无 CLI and three gaps.
  assert.equal(view.findAll({ type: 'Badge' }).length, 7)
  await view.unmount()
})
