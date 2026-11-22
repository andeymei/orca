import { describe, expect, it } from 'vitest'
import {
  isPathInsideScratch,
  refactorToolAllowed,
  refactorToolTargetPath
} from './refactor-write-gate'

const workspaceRoot = '/repo'
const scratchRoot = '/repo/.orca/refactor/job-1'

describe('isPathInsideScratch', () => {
  it('accepts a path inside the scratch root', () => {
    expect(isPathInsideScratch(scratchRoot, '/repo/.orca/refactor/job-1/p1/src/foo.ts')).toBe(true)
  })

  it('rejects a path that climbs out with ..', () => {
    expect(isPathInsideScratch(scratchRoot, '/repo/.orca/refactor/job-1/../../evil.ts')).toBe(false)
  })

  it('rejects an absolute path outside the scratch root', () => {
    expect(isPathInsideScratch(scratchRoot, '/etc/passwd')).toBe(false)
  })

  it('rejects a sibling directory that shares the prefix', () => {
    expect(isPathInsideScratch(scratchRoot, '/repo/.orca/refactor/job-1x/p1/foo.ts')).toBe(false)
  })
})

describe('refactorToolTargetPath', () => {
  it('reads the camel-cased path key', () => {
    expect(refactorToolTargetPath({ filePath: '/repo/src/foo.ts' })).toBe('/repo/src/foo.ts')
  })

  it('reads the bare path key', () => {
    expect(refactorToolTargetPath({ path: '/repo/src/foo.ts' })).toBe('/repo/src/foo.ts')
  })
})

describe('refactorToolAllowed', () => {
  it('allows reading', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Read',
        toolInput: { file_path: '/repo/src/foo.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(true)
  })

  it('allows writing inside the scratch root', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: '/repo/.orca/refactor/job-1/p1/src/foo.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(true)
  })

  it('denies writing outside the scratch root', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: '/repo/src/foo.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
  })

  it('denies a write whose input carries no path', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { content: 'x' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
  })

  it('denies a shell', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Bash',
        toolInput: { command: 'cp a b' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
  })

  it('resolves a relative write path against the workspace root', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: '.orca/refactor/job-1/p1/src/foo.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(true)
  })

  it('allows a multi-edit inside the scratch root', () => {
    expect(
      refactorToolAllowed({
        toolName: 'MultiEdit',
        toolInput: { file_path: '/repo/.orca/refactor/job-1/p1/src/foo.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(true)
  })
})
