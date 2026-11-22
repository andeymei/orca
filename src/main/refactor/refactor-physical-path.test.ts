import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolvePhysicalPath } from './refactor-physical-path'

describe('resolvePhysicalPath', () => {
  it('applies `..` to the directory a link points at, the way the kernel does', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'refactor-physical-'))
    const linkParent = path.join(base, 'ws')
    const target = path.join(base, 'target')
    await mkdir(linkParent, { recursive: true })
    await mkdir(target, { recursive: true })
    await symlink(target, path.join(linkParent, 'link'))
    // The kernel follows the link before it applies the `..`, so the file lands beside the link
    // and not beside the directory the link sits in.
    await expect(resolvePhysicalPath(`${linkParent}/link/../file.ts`)).resolves.toBe(
      path.join(await realpath(target), '..', 'file.ts')
    )
  })

  it('puts a file that is not there where the part of the path that is says', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'refactor-physical-'))
    await expect(resolvePhysicalPath(path.join(base, 'new', 'file.ts'))).resolves.toBe(
      path.join(await realpath(base), 'new', 'file.ts')
    )
  })

  it('keeps the spelling of a path the disk has never seen', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'refactor-physical-'))
    await expect(resolvePhysicalPath(path.join(base, 'MixedCase', 'file.ts'))).resolves.toBe(
      path.join(await realpath(base), 'MixedCase', 'file.ts')
    )
  })

  it('refuses a path that is not absolute', async () => {
    await expect(resolvePhysicalPath('relative/file.ts')).resolves.toBeNull()
  })
})
