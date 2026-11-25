import { afterEach, assert, test } from 'orca/testing'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectIdFor, scanProject } from './local-scan'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spec-board-'))
  roots.push(root)
  await mkdir(join(root, 'openspec/changes/add-x/specs/x'), { recursive: true })
  await writeFile(join(root, 'openspec/changes/add-x/proposal.md'), '# Change: Add X\n')
  await writeFile(join(root, 'openspec/changes/add-x/design.md'), '## Context\n')
  await writeFile(
    join(root, 'openspec/changes/add-x/tasks.md'),
    '- [x] one\n- [ ] two\n- [ ] three\n- [ ] four\n'
  )
  await writeFile(join(root, 'openspec/changes/add-x/specs/x/spec.md'), '## ADDED Requirements\n')
  await mkdir(join(root, 'openspec/specs/x'), { recursive: true })
  await writeFile(join(root, 'openspec/specs/x/spec.md'), '## Requirements\n')
  await mkdir(join(root, 'docs/superpowers/specs'), { recursive: true })
  await mkdir(join(root, 'docs/superpowers/plans'), { recursive: true })
  await writeFile(join(root, 'docs/superpowers/specs/2026-11-20-add-x-design.md'), '# Design\n')
  await writeFile(
    join(root, 'docs/superpowers/plans/2026-11-20-add-x.md'),
    '- [x] a\n- [ ] b\n- [ ] c\n- [ ] d\n- [ ] e\n- [ ] f\n- [ ] g\n- [ ] h\n'
  )
  return root
}

test('reads a change, its task progress and its matching plan', async () => {
  const root = await fixture()
  const result = await scanProject({ name: 'demo', host: 'local', path: root })
  assert.equal(result.project.openspec?.present, true)
  assert.equal(result.project.openspec?.activeChanges, 1)
  assert.equal(result.project.superpowers?.specs, 1)
  assert.equal(result.items.length, 1)
  const item = result.items[0]!
  assert.equal(item.openspec?.changeId, 'add-x')
  assert.equal(item.openspec?.tasksDone, 1)
  assert.equal(item.openspec?.tasksTotal, 4)
  assert.equal(item.openspec?.hasDesign, true)
  assert.equal(item.superpowers?.plan, 'docs/superpowers/plans/2026-11-20-add-x.md')
  assert.equal(item.superpowers?.planDone, 1)
  assert.equal(item.superpowers?.planTotal, 8)
  assert.deepEqual(result.warnings, [])
})

test('reports a project with neither directory as absent without throwing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spec-board-empty-'))
  roots.push(root)
  const result = await scanProject({ name: 'empty', host: 'local', path: root })
  assert.equal(result.project.openspec, null)
  assert.equal(result.project.superpowers, null)
  assert.deepEqual(result.items, [])
})

test('counts archived changes separately and does not list them as active', async () => {
  const root = await fixture()
  await mkdir(join(root, 'openspec/changes/archive/2026-11-01-old'), { recursive: true })
  const result = await scanProject({ name: 'demo', host: 'local', path: root })
  assert.equal(result.project.openspec?.archived, 1)
  assert.equal(result.project.openspec?.activeChanges, 1)
  assert.equal(result.items.filter((item) => item.openspec !== null).length, 1)
})

test('builds a stable project id from host and path', () => {
  assert.equal(projectIdFor('local', '/a/b'), 'local|/a/b')
})

test('an unreadable path is an error on the project, not a thrown scan', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spec-board-gone-'))
  roots.push(root)
  const result = await scanProject({ name: 'gone', host: 'local', path: join(root, 'not-there') })
  assert.equal(typeof result.project.error, 'string')
  assert.deepEqual(result.items, [])
})

test('a change whose tasks are all in progress counts them as in progress', async () => {
  const root = await fixture()
  await writeFile(
    join(root, 'openspec/changes/add-x/tasks.md'),
    '- [-] one\n- [~] two\n- [ ] three\n'
  )
  const result = await scanProject({ name: 'demo', host: 'local', path: root })
  const item = result.items[0]!
  assert.equal(item.openspec?.tasksInProgress, 2)
  assert.equal(item.openspec?.tasksDone, 0)
  assert.equal(item.openspec?.tasksTotal, 3)
})

test('a Superpowers artifact with no change of its own is an item on its own', async () => {
  const root = await fixture()
  await writeFile(
    join(root, 'docs/superpowers/plans/2026-11-21-elsewhere.md'),
    '- [x] a\n- [x] b\n'
  )
  const result = await scanProject({ name: 'demo', host: 'local', path: root })
  const orphan = result.items.find((item) => item.openspec === null)
  assert.ok(orphan, 'the unmatched plan is an item of its own')
  assert.equal(orphan.superpowers?.plan, 'docs/superpowers/plans/2026-11-21-elsewhere.md')
  assert.equal(orphan.superpowers?.planDone, 2)
  assert.equal(result.items.length, 2)
})

test('lists the capabilities the project already has specs for', async () => {
  const root = await fixture()
  await mkdir(join(root, 'openspec/specs/y'), { recursive: true })
  await writeFile(join(root, 'openspec/specs/y/spec.md'), '## Requirements\n')
  const result = await scanProject({ name: 'demo', host: 'local', path: root })
  assert.deepEqual(result.project.openspec?.capabilities, ['x', 'y'])
})
