import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pathMatchesAtSameRealPath } from './project-realpath-identity'

describe('pathMatchesAtSameRealPath', () => {
  it('matches the same path', () => {
    expect(pathMatchesAtSameRealPath('/repos/app', '/repos/app')).toBe(true)
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
      expect(pathMatchesAtSameRealPath(real, link)).toBe(true)
      expect(pathMatchesAtSameRealPath(link, real)).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not match unrelated paths', () => {
    expect(pathMatchesAtSameRealPath('/repos/app', '/repos/other')).toBe(false)
    expect(pathMatchesAtSameRealPath('/repos/app', '/repos/app2')).toBe(false)
  })

  it('does not match a path that does not exist', () => {
    expect(pathMatchesAtSameRealPath('/repos/app', '/nowhere/app')).toBe(false)
  })
})
