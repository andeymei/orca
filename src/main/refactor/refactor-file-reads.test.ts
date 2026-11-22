import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { listScratchProposals, readScratchFile } from './refactor-file-reads'

const roots: string[] = []

async function scratchRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'refactor-files-'))
  roots.push(root)
  return root
}

describe('listScratchProposals', () => {
  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('names a file relative to its proposal directory', async () => {
    // The plan reads `<scratchRoot>/p1/src/foo.ts` under the name `src/foo.ts`; a path relative
    // to the workspace root would read a directory nobody wrote.
    const root = await scratchRoot()
    await fs.mkdir(path.join(root, 'p1', 'src'), { recursive: true })
    await fs.writeFile(path.join(root, 'p1', 'src', 'foo.ts'), 'a\n')
    await fs.writeFile(path.join(root, 'manifest.json'), '{}')
    const proposals = await listScratchProposals(root)
    expect(proposals).toEqual([{ id: 'p1', files: ['src/foo.ts'] }])
  })

  it('lists the files of every proposal directory', async () => {
    const root = await scratchRoot()
    await fs.mkdir(path.join(root, 'p1'), { recursive: true })
    await fs.writeFile(path.join(root, 'p1', 'a.ts'), 'a\n')
    await fs.mkdir(path.join(root, 'p2', 'lib'), { recursive: true })
    await fs.writeFile(path.join(root, 'p2', 'lib', 'b.ts'), 'b\n')
    const proposals = await listScratchProposals(root)
    expect([...proposals].sort((left, right) => left.id.localeCompare(right.id))).toEqual([
      { id: 'p1', files: ['a.ts'] },
      { id: 'p2', files: ['lib/b.ts'] }
    ])
  })
})

describe('readScratchFile', () => {
  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('reads a file of a proposal', async () => {
    const root = await scratchRoot()
    await fs.mkdir(path.join(root, 'p1'), { recursive: true })
    await fs.writeFile(path.join(root, 'p1', 'a.ts'), 'a\n')
    expect(await readScratchFile(root, 'p1', 'a.ts')).toBe('a\n')
  })

  it('refuses a proposal id that climbs out of the scratch root', async () => {
    const root = await scratchRoot()
    await fs.writeFile(path.join(root, 'secret.ts'), 'secret\n')
    expect(await readScratchFile(root, '..', 'secret.ts')).toBeNull()
  })

  it('refuses a file path that climbs out of the proposal directory', async () => {
    const root = await scratchRoot()
    await fs.mkdir(path.join(root, 'p1'), { recursive: true })
    await fs.writeFile(path.join(root, 'secret.ts'), 'secret\n')
    expect(await readScratchFile(root, 'p1', '../secret.ts')).toBeNull()
  })
})
