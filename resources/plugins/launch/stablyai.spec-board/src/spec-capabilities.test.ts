// The capability directories under a project's `openspec/specs/`. A directory that is not there
// is an empty list; one that cannot be read is unknown — and unknown is not the same as empty.
import { afterEach, assert, test } from 'orca/testing'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSpecCapabilities } from './spec-capabilities'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

async function home(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spec-board-caps-'))
  roots.push(root)
  return root
}

test('a directory that is not there is an empty list', async () => {
  const root = await home()
  assert.deepEqual(await readSpecCapabilities(root), [])
})

test('the capability directories are named, and only the directories', async () => {
  const root = await home()
  await mkdir(join(root, 'openspec', 'specs', 'core'), { recursive: true })
  await mkdir(join(root, 'openspec', 'specs', 'billing'), { recursive: true })
  await writeFile(join(root, 'openspec', 'specs', 'notes.md'), 'x', 'utf8')
  assert.deepEqual(await readSpecCapabilities(root), ['billing', 'core'])
})

test('a directory that cannot be listed is unknown, not empty', async () => {
  const root = await home()
  const specs = join(root, 'openspec', 'specs')
  await mkdir(specs, { recursive: true })
  await chmod(specs, 0o000)
  const capabilities = await readSpecCapabilities(root)
  await chmod(specs, 0o755)
  // Root reads every directory, so the environment cannot produce an unreadable one there.
  const canBeUnreadable = process.getuid !== undefined && process.getuid() !== 0
  if (!canBeUnreadable) {
    // The readable case is asserted instead: the test is never vacuous.
    assert.deepEqual(capabilities, [])
    return
  }
  assert.equal(capabilities, undefined)
})
