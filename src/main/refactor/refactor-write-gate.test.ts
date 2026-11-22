import { describe, expect, it } from 'vitest'
import {
  isPathInsideScratch,
  isPathInsideWorkspace,
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

  it('rejects a path that escapes once the trailing space is stripped', () => {
    expect(isPathInsideScratch(scratchRoot, '/repo/.orca/refactor/job-1/.. /../evil.ts')).toBe(
      false
    )
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

  it('rejects a path whose segment ends in a space, because Windows strips it', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: '/repo/.orca/refactor/job-1/.. /.. /evil.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
  })

  it('rejects a path whose segment ends in a dot, because Windows strips it', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: '/repo/.orca/refactor/job-1/.../../evil.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
  })

  it('denies an unknown tool name', () => {
    expect(
      refactorToolAllowed({
        toolName: 'NotebookEdit',
        toolInput: { file_path: '/repo/src/foo.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
  })

  it('denies a write whose path is only whitespace', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: '   ' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
  })

  it('denies a differently cased path, because the comparison is case sensitive', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: '/repo/.ORCA/refactor/job-1/p1/src/foo.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
  })

  it('allows a read inside the workspace', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Read',
        toolInput: { file_path: '/repo/src/foo.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(true)
  })

  it('denies a read outside the workspace', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Read',
        toolInput: { file_path: '/home/mac/.ssh/id_rsa' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
  })

  it('denies a read whose input carries no path', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Read',
        toolInput: {},
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
  })

  it('allows a grep without a path, because it searches from the workspace root', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Grep',
        toolInput: { pattern: 'needle' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(true)
  })

  it('denies a grep pointed outside the workspace', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Grep',
        toolInput: { pattern: 'needle', path: '/home/mac' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
  })

  it('allows an edit inside the scratch root', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Edit',
        toolInput: { file_path: '/repo/.orca/refactor/job-1/p1/src/foo.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(true)
  })

  it('denies an edit outside the scratch root', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Edit',
        toolInput: { file_path: '/repo/src/foo.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
  })

  it('allows a write to the scratch root itself', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: scratchRoot },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(true)
  })

  it('allows a grep rooted at the workspace root', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Grep',
        toolInput: { pattern: 'needle', path: workspaceRoot },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(true)
  })

  it('denies a write whose escape only appears once the trailing space is stripped', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: '/repo/.. /../evil.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
  })

  it('denies a read whose escape only appears once the trailing space is stripped', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Read',
        toolInput: { file_path: '/repo/.. /../evil.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
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

describe('isPathInsideWorkspace', () => {
  it('rejects a path that escapes once the trailing space is stripped', () => {
    expect(isPathInsideWorkspace('/repo', '/repo/.. /../evil.ts')).toBe(false)
  })
})
