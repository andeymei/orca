import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { cleanExpiredRefactorScratch } from './refactor-scratch-cleanup'

const DAY_MS = 24 * 60 * 60 * 1000
const now = 1_700_000_000_000
const roots: string[] = []

async function scratchRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'refactor-scratch-'))
  roots.push(root)
  return root
}

async function jobDir(root: string, name: string, ageMs: number): Promise<string> {
  const dir = path.join(root, name)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'file.ts'), 'x')
  const when = new Date(now - ageMs)
  await fs.utimes(dir, when, when)
  return dir
}

describe('cleanExpiredRefactorScratch', () => {
  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('removes a scratch directory older than a day', async () => {
    const root = await scratchRoot()
    const old = await jobDir(root, 'old-job', DAY_MS + 1000)
    const removed = await cleanExpiredRefactorScratch({ scratchParentRoot: root, now })
    expect(removed).toEqual(['old-job'])
    await expect(fs.stat(old)).rejects.toThrow()
  })

  it('keeps a scratch directory from today', async () => {
    const root = await scratchRoot()
    const fresh = await jobDir(root, 'fresh-job', 1000)
    const removed = await cleanExpiredRefactorScratch({ scratchParentRoot: root, now })
    expect(removed).toEqual([])
    await expect(fs.stat(fresh)).resolves.toBeTruthy()
  })

  it('keeps the current job even when it looks old', async () => {
    const root = await scratchRoot()
    await jobDir(root, 'current-job', DAY_MS + 1000)
    const removed = await cleanExpiredRefactorScratch({
      scratchParentRoot: root,
      excludeJobId: 'current-job',
      now
    })
    expect(removed).toEqual([])
  })

  it('does nothing when there is no scratch directory yet', async () => {
    const root = await scratchRoot()
    const removed = await cleanExpiredRefactorScratch({
      scratchParentRoot: path.join(root, 'missing'),
      now
    })
    expect(removed).toEqual([])
  })
})
