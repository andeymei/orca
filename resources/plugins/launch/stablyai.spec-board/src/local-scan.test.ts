import { afterEach, assert, test } from 'orca/testing'
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
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
    '- [x] one\n- [-] two\n- [ ] three\n- [ ] four\n'
  )
  await writeFile(join(root, 'openspec/changes/add-x/specs/x/spec.md'), '## ADDED Requirements\n')
  await mkdir(join(root, 'openspec/specs/x'), { recursive: true })
  await writeFile(join(root, 'openspec/specs/x/spec.md'), '## Requirements\n')
  await mkdir(join(root, 'docs/superpowers/specs'), { recursive: true })
  await mkdir(join(root, 'docs/superpowers/plans'), { recursive: true })
  await writeFile(join(root, 'docs/superpowers/specs/2026-11-20-add-x-design.md'), '# Design\n')
  await writeFile(
    join(root, 'docs/superpowers/plans/2026-11-20-add-x.md'),
    '- [x] a\n- [~] b\n- [ ] c\n- [ ] d\n- [ ] e\n- [ ] f\n- [ ] g\n- [ ] h\n'
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
  assert.equal(item.id, `${projectIdFor('local', root)}#add-x`)
  assert.equal(item.projectId, projectIdFor('local', root))
  assert.equal(item.topic, 'add-x')
  assert.equal(item.title, 'add-x')
  assert.equal(item.openspec?.changeId, 'add-x')
  assert.equal(item.openspec?.hasProposal, true)
  assert.equal(item.openspec?.hasDesign, true)
  assert.equal(item.openspec?.hasTasks, true)
  assert.equal(item.openspec?.tasksDone, 1)
  assert.equal(item.openspec?.tasksInProgress, 1)
  assert.equal(item.openspec?.tasksTotal, 4)
  assert.deepEqual(item.openspec?.capabilities, ['x'])
  assert.equal(item.openspec?.stage, 'implementing')
  assert.equal(item.superpowers?.designSpec, 'docs/superpowers/specs/2026-11-20-add-x-design.md')
  assert.equal(item.superpowers?.plan, 'docs/superpowers/plans/2026-11-20-add-x.md')
  assert.equal(item.superpowers?.planDone, 1)
  assert.equal(item.superpowers?.planInProgress, 1)
  assert.equal(item.superpowers?.planTotal, 8)
  assert.equal(item.superpowers?.stage, 'executing')
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

test('a path that is a file is an error on the project, not a thrown scan', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spec-board-file-'))
  roots.push(root)
  const file = join(root, 'not-a-project')
  await writeFile(file, 'hello\n')
  const result = await scanProject({ name: 'file', host: 'local', path: file })
  assert.equal(typeof result.project.error, 'string')
  assert.deepEqual(result.items, [])
})

test('a directory that cannot be listed still counts as present', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spec-board-locked-'))
  roots.push(root)
  const specs = join(root, 'openspec/specs')
  await mkdir(join(specs, 'y'), { recursive: true })
  await chmod(specs, 0o000)
  try {
    // Windows has no chmod, and a superuser reads every directory, so the unreadable case cannot
    // be produced there — the unreadable assertions below were not exercised on such a machine.
    // The readable case is asserted either way: the directory is there, so the project has
    // OpenSpec and the entries inside it are read.
    if ((await readdir(specs).catch(() => null)) !== null) {
      const readable = await scanProject({ name: 'locked', host: 'local', path: root })
      assert.equal(readable.project.openspec?.present, true)
      assert.deepEqual(readable.project.openspec?.capabilities, ['y'])
      assert.deepEqual(readable.warnings, [])
      return
    }
    const result = await scanProject({ name: 'locked', host: 'local', path: root })
    assert.equal(result.project.openspec?.present, true)
    assert.equal(result.project.openspec?.capabilities.length, 0)
    assert.ok(result.warnings.length > 0, result.warnings.join(' | '))
  } finally {
    await chmod(specs, 0o755).catch(() => undefined)
  }
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
  assert.equal(item.openspec?.stage, 'implementing')
})

test('a change whose tasks are all done reads as validated', async () => {
  const root = await fixture()
  await mkdir(join(root, 'openspec/changes/done-x'), { recursive: true })
  await writeFile(join(root, 'openspec/changes/done-x/tasks.md'), '- [x] one\n- [x] two\n')
  const result = await scanProject({ name: 'demo', host: 'local', path: root })
  const done = result.items.find((item) => item.openspec?.changeId === 'done-x')!
  assert.equal(done.openspec?.stage, 'validated')
  assert.equal(done.openspec?.tasksDone, 2)
  assert.equal(done.openspec?.tasksTotal, 2)
})

test('a change with only a design spec says what it does not have', async () => {
  const root = await fixture()
  await mkdir(join(root, 'openspec/changes/bare_change'), { recursive: true })
  await writeFile(
    join(root, 'docs/superpowers/specs/2026-11-20-bare_change-design.md'),
    '# Design\n'
  )
  const result = await scanProject({ name: 'demo', host: 'local', path: root })
  const bare = result.items.find((item) => item.openspec?.changeId === 'bare_change')!
  assert.equal(bare.id, `${projectIdFor('local', root)}#bare-change`)
  assert.equal(bare.topic, 'bare-change')
  assert.equal(bare.title, 'bare_change')
  assert.equal(bare.openspec?.hasProposal, false)
  assert.equal(bare.openspec?.hasDesign, false)
  assert.equal(bare.openspec?.hasTasks, false)
  assert.equal(bare.openspec?.stage, 'proposed')
  assert.equal(
    bare.superpowers?.designSpec,
    'docs/superpowers/specs/2026-11-20-bare_change-design.md'
  )
  assert.equal(bare.superpowers?.plan, null)
  assert.equal(bare.superpowers?.stage, 'designed')
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
  assert.equal(orphan.superpowers?.planTotal, 2)
  assert.equal(orphan.superpowers?.stage, 'done')
  assert.equal(result.items.length, 2)
})

test('lists the capabilities the project already has specs for', async () => {
  const root = await fixture()
  await mkdir(join(root, 'openspec/specs/y'), { recursive: true })
  await writeFile(join(root, 'openspec/specs/y/spec.md'), '## Requirements\n')
  const result = await scanProject({ name: 'demo', host: 'local', path: root })
  assert.deepEqual(result.project.openspec?.capabilities, ['x', 'y'])
})

test('a file whose name carries no topic is skipped, and the warning names it', async () => {
  const root = await fixture()
  await writeFile(join(root, 'docs/superpowers/plans/.md'), '- [x] a\n')
  await mkdir(join(root, 'openspec/changes/---'), { recursive: true })
  const result = await scanProject({ name: 'demo', host: 'local', path: root })
  assert.equal(result.items.length, 1)
  assert.ok(
    result.warnings.some((warning) => warning.includes('docs/superpowers/plans/.md')),
    result.warnings.join(' | ')
  )
  assert.ok(
    result.warnings.some((warning) => warning.includes('openspec/changes/---')),
    result.warnings.join(' | ')
  )
})
