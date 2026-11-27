// The framework palette: what both frameworks offer as buttons, and how a palette action takes
// the change it acts on.
import { assert, test } from 'orca/testing'
import { frameworkActions, resolvePaletteAction } from './actions'
import { promptOf } from './action-fixture'

test('the framework palette lists both frameworks', () => {
  const palette = frameworkActions(false)
  assert.ok(palette.openspec.length >= 4)
  assert.ok(palette.superpowers.length >= 5)
  assert.ok(palette.openspec.every((action) => action.run.kind === 'agent'))
})

test('the palette lists every command of both frameworks', () => {
  const palette = frameworkActions(false)
  assert.deepEqual(
    palette.openspec.map((action) => action.id),
    [
      'openspec.list',
      'openspec.propose',
      'openspec.validate',
      'openspec.show',
      'openspec.complete',
      'openspec.implement',
      'openspec.archive'
    ]
  )
  assert.deepEqual(
    palette.superpowers.map((action) => action.id),
    [
      'superpowers.brainstorm',
      'superpowers.plan',
      'superpowers.execute',
      'superpowers.review',
      'superpowers.verify',
      'superpowers.finish'
    ]
  )
})

test('the palette runs the CLI where there is one and leaves the rest to the agent', () => {
  const palette = frameworkActions(true)
  assert.deepEqual(
    palette.openspec
      .filter((action) => action.run.kind === 'terminal')
      .map((action) => action.run),
    [
      { kind: 'terminal', command: 'openspec list' },
      { kind: 'terminal', command: 'openspec validate <change-id> --strict' },
      { kind: 'terminal', command: 'openspec show <change-id> --json --deltas-only' },
      { kind: 'terminal', command: 'openspec archive <change-id> --yes' }
    ]
  )
  // The steps the CLI has no command for are the agent's: the proposal, filling a change in and
  // implementing it.
  for (const action of palette.openspec.filter((entry) => entry.run.kind === 'agent')) {
    assert.match(promptOf(action), /openspec\/AGENTS\.md/, action.id)
  }
})

test('the palette grades every command with the mutates flag of its row', () => {
  const palette = frameworkActions(false)
  assert.deepEqual(
    palette.openspec.map((action) => [action.id, action.mutates]),
    [
      ['openspec.list', false],
      ['openspec.propose', true],
      ['openspec.validate', false],
      ['openspec.show', false],
      ['openspec.complete', true],
      ['openspec.implement', true],
      ['openspec.archive', true]
    ]
  )
  assert.deepEqual(
    palette.superpowers.map((action) => [action.id, action.mutates]),
    [
      ['superpowers.brainstorm', true],
      ['superpowers.plan', true],
      ['superpowers.execute', true],
      ['superpowers.review', false],
      ['superpowers.verify', false],
      ['superpowers.finish', true]
    ]
  )
})

test('the palette falls back to the agent for every OpenSpec command', () => {
  const palette = frameworkActions(false)
  for (const action of palette.openspec) {
    assert.equal(action.run.kind, 'agent', action.id)
    assert.match(promptOf(action), /openspec\/AGENTS\.md/, action.id)
  }
})

test('every action id the design lists exists', () => {
  const palette = frameworkActions(false)
  assert.deepEqual(
    [...palette.openspec, ...palette.superpowers].map((action) => action.id).sort(),
    [
      'openspec.archive',
      'openspec.complete',
      'openspec.implement',
      'openspec.list',
      'openspec.propose',
      'openspec.show',
      'openspec.validate',
      'superpowers.brainstorm',
      'superpowers.execute',
      'superpowers.finish',
      'superpowers.plan',
      'superpowers.review',
      'superpowers.verify'
    ]
  )
})

test("the palette's agent prompt still carries the placeholder", () => {
  const palette = frameworkActions(false)
  const validate = palette.openspec.find((action) => action.id === 'openspec.validate')!
  assert.match(promptOf(validate), /<change-id>/)
})

test("the palette's placeholder is exempt by provenance, not by content", () => {
  const palette = frameworkActions(true)
  const validate = palette.openspec.find((action) => action.id === 'openspec.validate')!
  assert.deepEqual(validate.run, {
    kind: 'terminal',
    command: 'openspec validate <change-id> --strict'
  })
  const resolved = resolvePaletteAction(validate, 'add-x')
  assert.equal(resolved.ok, true)
  assert.deepEqual(resolved.ok && resolved.action.run, {
    kind: 'terminal',
    command: 'openspec validate add-x --strict'
  })
})

test('a palette command with no change id needs one', () => {
  const palette = frameworkActions(true)
  const validate = palette.openspec.find((action) => action.id === 'openspec.validate')!
  assert.deepEqual(resolvePaletteAction(validate, undefined), {
    ok: false,
    reason: 'needs-change-id'
  })
})

test('a palette command with an unsafe change id is refused', () => {
  const palette = frameworkActions(true)
  const validate = palette.openspec.find((action) => action.id === 'openspec.validate')!
  assert.deepEqual(resolvePaletteAction(validate, 'x; rm -rf /'), {
    ok: false,
    reason: 'unsafe-change-id'
  })
})

test('a palette command with a safe change id resolves to a runnable command', () => {
  const palette = frameworkActions(true)
  const validate = palette.openspec.find((action) => action.id === 'openspec.validate')!
  const resolved = resolvePaletteAction(validate, 'add-x')
  assert.equal(resolved.ok, true)
  assert.deepEqual(resolved.ok && resolved.action.run, {
    kind: 'terminal',
    command: 'openspec validate add-x --strict'
  })
})

test("the palette's agent form resolves the change id too", () => {
  const palette = frameworkActions(false)
  const validate = palette.openspec.find((action) => action.id === 'openspec.validate')!
  const resolved = resolvePaletteAction(validate, 'add-x')
  assert.equal(resolved.ok, true)
  const prompt = resolved.ok ? promptOf(resolved.action) : ''
  assert.match(prompt, /严格校验变更 add-x/)
  assert.equal(prompt.includes('<change-id>'), false)
})

test('a project-scoped palette action resolves to itself', () => {
  const palette = frameworkActions(true)
  const list = palette.openspec.find((action) => action.id === 'openspec.list')!
  assert.deepEqual(resolvePaletteAction(list, undefined), { ok: true, action: list })
})

test('a project-scoped palette action ignores the change id', () => {
  const palette = frameworkActions(true)
  const list = palette.openspec.find((action) => action.id === 'openspec.list')!
  assert.deepEqual(resolvePaletteAction(list, 'x; rm -rf /'), { ok: true, action: list })
})

test('the palette of a remote project is the agent form too', () => {
  const palette = frameworkActions(true, { host: 'runtime:env-1', path: 'C:/work/remote' })
  for (const action of palette.openspec) {
    assert.equal(action.run.kind, 'agent', action.id)
  }
})
