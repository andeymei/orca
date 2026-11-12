import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pathMatchesAtSameRealPath } from './project-realpath-identity'

describe('pathMatchesAtSameRealPath', () => {
  it('matches the same path', async () => {
    await expect(pathMatchesAtSameRealPath('/repos/app', '/repos/app')).resolves.toBe(true)
  })

  it('matches a path that traverses a symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-realpath-identity-'))
    try {
      const real = join(root, 'real')
      const link = join(root, 'link')
      await mkdir(real, { recursive: true })
      await symlink(real, link)
      // Git reports a repository's root as its realpath, so the stored path and the path a
      // caller names can be two strings for one checkout.
      await expect(pathMatchesAtSameRealPath(real, link)).resolves.toBe(true)
      await expect(pathMatchesAtSameRealPath(link, real)).resolves.toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not match unrelated paths', async () => {
    await expect(pathMatchesAtSameRealPath('/repos/app', '/repos/other')).resolves.toBe(false)
    await expect(pathMatchesAtSameRealPath('/repos/app', '/repos/app2')).resolves.toBe(false)
  })

  it('does not match a path that does not exist', async () => {
    await expect(pathMatchesAtSameRealPath('/repos/app', '/nowhere/app')).resolves.toBe(false)
  })
})
