// The registry is the one file a person may edit by hand, so reading it never throws: a file that
// is not there is not a warning, and a file that is broken is a warning that names it.
import { afterEach, assert, test } from 'orca/testing'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { boardStoreDir, readRegistry, registryPath, writeRegistryIfAbsent } from './store-paths'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
  delete process.env.SPEC_BOARD_HOME
})

async function home(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spec-board-store-'))
  roots.push(root)
  process.env.SPEC_BOARD_HOME = root
  return root
}

test('the store directory follows SPEC_BOARD_HOME', async () => {
  const root = await home()
  assert.equal(boardStoreDir(), root)
  assert.equal(registryPath(), join(root, 'projects.json'))
})

test('a registry that is not there is not a warning', async () => {
  await home()
  assert.deepEqual(await readRegistry(), { registry: null, warning: null })
})

test('a malformed registry is a warning that names the file, and no registry', async () => {
  const root = await home()
  await writeFile(join(root, 'projects.json'), '{ not json', 'utf8')
  const { registry, warning } = await readRegistry()
  assert.equal(registry, null)
  assert.ok(warning !== null && warning.includes('projects.json'))
})

test('a registry whose shape is wrong is refused as well', async () => {
  const root = await home()
  await writeFile(
    join(root, 'projects.json'),
    JSON.stringify({ schemaVersion: 1, projects: [{ name: 'demo' }] }),
    'utf8'
  )
  const { registry, warning } = await readRegistry()
  assert.equal(registry, null)
  // The warning says the shape is wrong, not that the registry is empty: a broken entry is not
  // the same thing as no entry.
  assert.ok(warning !== null && warning.includes('格式不对'))
})

test('an empty registry reads as no registry, and says nothing', async () => {
  const root = await home()
  await writeFile(
    join(root, 'projects.json'),
    JSON.stringify({ schemaVersion: 1, projects: [] }),
    'utf8'
  )
  const { registry, warning } = await readRegistry()
  assert.equal(registry, null)
  // The projects come from Orca now, so an empty registry is nothing to warn about: it is the
  // person's file, and it adds projects rather than naming the ones to scan.
  assert.equal(warning, null)
})

test('a registry is read as it was written', async () => {
  const root = await home()
  const projects = [{ name: 'demo', host: 'local', path: '/repo' }]
  await writeFile(
    join(root, 'projects.json'),
    JSON.stringify({ schemaVersion: 1, projects }),
    'utf8'
  )
  assert.deepEqual(await readRegistry(), {
    registry: { schemaVersion: 1, projects },
    warning: null
  })
})

test('the fallback registry is written once, and never over the one a person edited', async () => {
  const root = await home()
  const projects = [{ name: 'demo', host: 'local', path: '/repo' }]
  await writeRegistryIfAbsent(projects)
  const written = JSON.parse(await readFile(join(root, 'projects.json'), 'utf8'))
  assert.deepEqual(written, { schemaVersion: 1, projects })

  await writeRegistryIfAbsent([{ name: 'other', host: 'local', path: '/other' }])
  const again = JSON.parse(await readFile(join(root, 'projects.json'), 'utf8'))
  assert.deepEqual(again, { schemaVersion: 1, projects })
})
