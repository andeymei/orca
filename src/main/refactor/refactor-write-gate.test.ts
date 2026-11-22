import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  isPathInsideScratch,
  isPathInsideWorkspace,
  refactorToolAllowed,
  refactorToolTargetPath,
  resolveRefactorGateRoots
} from './refactor-write-gate'

const workspaceRoot = '/repo'
const scratchRoot = '/repo/.orca/refactor/job-1'

const roots = await resolveRefactorGateRoots({ scratchRoot, workspaceRoot })

// The roots above do not exist on disk, so the blocks that use them cover the raw-path rules only.
describe('isPathInsideScratch', () => {
  it('accepts a path inside the scratch root', async () => {
    await expect(
      isPathInsideScratch(scratchRoot, '/repo/.orca/refactor/job-1/p1/src/foo.ts')
    ).resolves.toBe(true)
  })

  it('rejects a path that climbs out with ..', async () => {
    await expect(
      isPathInsideScratch(scratchRoot, '/repo/.orca/refactor/job-1/../../evil.ts')
    ).resolves.toBe(false)
  })

  it('rejects an absolute path outside the scratch root', async () => {
    await expect(isPathInsideScratch(scratchRoot, '/etc/passwd')).resolves.toBe(false)
  })

  it('rejects a sibling directory that shares the prefix', async () => {
    await expect(
      isPathInsideScratch(scratchRoot, '/repo/.orca/refactor/job-1x/p1/foo.ts')
    ).resolves.toBe(false)
  })

  it('rejects a path that escapes once the trailing space is stripped', async () => {
    await expect(
      isPathInsideScratch(scratchRoot, '/repo/.orca/refactor/job-1/.. /../evil.ts')
    ).resolves.toBe(false)
  })
})

describe('refactorToolAllowed', () => {
  it('allows reading', async () => {
    await expect(
      refactorToolAllowed({
        toolName: 'Read',
        toolInput: { file_path: '/repo/src/foo.ts' },
        roots
      })
    ).resolves.toBe(true)
  })

  it('allows writing inside the scratch root', async () => {
    await expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: '/repo/.orca/refactor/job-1/p1/src/foo.ts' },
        roots
      })
    ).resolves.toBe(true)
  })

  it('denies writing outside the scratch root', async () => {
    await expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: '/repo/src/foo.ts' },
        roots
      })
    ).resolves.toBe(false)
  })

  it('denies a write whose input carries no path', async () => {
    await expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { content: 'x' },
        roots
      })
    ).resolves.toBe(false)
  })

  it('denies a shell', async () => {
    await expect(
      refactorToolAllowed({
        toolName: 'Bash',
        toolInput: { command: 'cp a b' },
        roots
      })
    ).resolves.toBe(false)
  })

  it('resolves a relative write path against the workspace root', async () => {
    await expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: '.orca/refactor/job-1/p1/src/foo.ts' },
        roots
      })
    ).resolves.toBe(true)
  })

  it('allows a multi-edit inside the scratch root', async () => {
    await expect(
      refactorToolAllowed({
        toolName: 'MultiEdit',
        toolInput: { file_path: '/repo/.orca/refactor/job-1/p1/src/foo.ts' },
        roots
      })
    ).resolves.toBe(true)
  })

  it('rejects a path whose segment ends in a space, because Windows strips it', async () => {
    await expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: '/repo/.orca/refactor/job-1/.. /.. /evil.ts' },
        roots
      })
    ).resolves.toBe(false)
  })

  it('rejects a path whose segment ends in a dot, because Windows strips it', async () => {
    await expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: '/repo/.orca/refactor/job-1/.../../evil.ts' },
        roots
      })
    ).resolves.toBe(false)
  })

  it('denies an unknown tool name', async () => {
    await expect(
      refactorToolAllowed({
        toolName: 'NotebookEdit',
        toolInput: { file_path: '/repo/src/foo.ts' },
        roots
      })
    ).resolves.toBe(false)
  })

  it('denies a write whose path is only whitespace', async () => {
    await expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: '   ' },
        roots
      })
    ).resolves.toBe(false)
  })

  it('denies a differently cased path whose directory is not on disk', async () => {
    await expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: '/repo/.ORCA/refactor/job-1/p1/src/foo.ts' },
        roots
      })
    ).resolves.toBe(false)
  })

  it('allows a read inside the workspace', async () => {
    await expect(
      refactorToolAllowed({
        toolName: 'Read',
        toolInput: { file_path: '/repo/src/foo.ts' },
        roots
      })
    ).resolves.toBe(true)
  })

  it('denies a read outside the workspace', async () => {
    await expect(
      refactorToolAllowed({
        toolName: 'Read',
        toolInput: { file_path: '/home/mac/.ssh/id_rsa' },
        roots
      })
    ).resolves.toBe(false)
  })

  it('denies a drive-relative read, because Windows resolves it against that drive', async () => {
    await expect(
      refactorToolAllowed({
        toolName: 'Read',
        toolInput: { file_path: 'D:secrets/token.txt' },
        roots
      })
    ).resolves.toBe(false)
  })

  it('denies a drive-relative search path, because Windows resolves it against that drive', async () => {
    await expect(
      refactorToolAllowed({
        toolName: 'Grep',
        toolInput: { pattern: 'needle', path: 'D:secrets' },
        roots
      })
    ).resolves.toBe(false)
  })

  it('denies a read whose input carries no path', async () => {
    await expect(
      refactorToolAllowed({
        toolName: 'Read',
        toolInput: {},
        roots
      })
    ).resolves.toBe(false)
  })

  it('allows a grep without a path, because it searches from the workspace root', async () => {
    await expect(
      refactorToolAllowed({
        toolName: 'Grep',
        toolInput: { pattern: 'needle' },
        roots
      })
    ).resolves.toBe(true)
  })

  it('denies a grep pointed outside the workspace', async () => {
    await expect(
      refactorToolAllowed({
        toolName: 'Grep',
        toolInput: { pattern: 'needle', path: '/home/mac' },
        roots
      })
    ).resolves.toBe(false)
  })

  it('allows an edit inside the scratch root', async () => {
    await expect(
      refactorToolAllowed({
        toolName: 'Edit',
        toolInput: { file_path: '/repo/.orca/refactor/job-1/p1/src/foo.ts' },
        roots
      })
    ).resolves.toBe(true)
  })

  it('denies an edit outside the scratch root', async () => {
    await expect(
      refactorToolAllowed({
        toolName: 'Edit',
        toolInput: { file_path: '/repo/src/foo.ts' },
        roots
      })
    ).resolves.toBe(false)
  })

  it('allows a write to the scratch root itself', async () => {
    await expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: scratchRoot },
        roots
      })
    ).resolves.toBe(true)
  })

  it('allows a grep rooted at the workspace root', async () => {
    await expect(
      refactorToolAllowed({
        toolName: 'Grep',
        toolInput: { pattern: 'needle', path: workspaceRoot },
        roots
      })
    ).resolves.toBe(true)
  })

  it('denies a write whose escape only appears once the trailing space is stripped', async () => {
    await expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: '/repo/.. /../evil.ts' },
        roots
      })
    ).resolves.toBe(false)
  })

  it('denies a read whose escape only appears once the trailing space is stripped', async () => {
    await expect(
      refactorToolAllowed({
        toolName: 'Read',
        toolInput: { file_path: '/repo/.. /../evil.ts' },
        roots
      })
    ).resolves.toBe(false)
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
  it('rejects a path that escapes once the trailing space is stripped', async () => {
    await expect(isPathInsideWorkspace('/repo', '/repo/.. /../evil.ts')).resolves.toBe(false)
  })
})

describe('the gate and the physical location of a path', () => {
  it('allows a read of a file the CLI names by its real path', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'refactor-gate-'))
    const real = path.join(base, 'real')
    const linked = path.join(base, 'linked')
    await mkdir(path.join(real, 'src'), { recursive: true })
    await writeFile(path.join(real, 'src', 'foo.ts'), 'export const a = 1\n', 'utf8')
    await symlink(real, linked)
    const gateRoots = await resolveRefactorGateRoots({
      scratchRoot: path.join(linked, '.orca', 'refactor', 'job-1'),
      workspaceRoot: linked
    })
    await expect(
      refactorToolAllowed({
        toolName: 'Read',
        toolInput: { file_path: path.join(real, 'src', 'foo.ts') },
        roots: gateRoots
      })
    ).resolves.toBe(true)
  })

  it('denies a write through a link that leaves the scratch root', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'refactor-gate-'))
    const workspace = path.join(base, 'workspace')
    const outside = path.join(base, 'outside')
    const gateScratchRoot = path.join(workspace, '.orca', 'refactor', 'job-1')
    await mkdir(gateScratchRoot, { recursive: true })
    await mkdir(outside, { recursive: true })
    await symlink(outside, path.join(gateScratchRoot, 'out'))
    const gateRoots = await resolveRefactorGateRoots({
      scratchRoot: gateScratchRoot,
      workspaceRoot: workspace
    })
    await expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: path.join(gateScratchRoot, 'out', 'evil.ts') },
        roots: gateRoots
      })
    ).resolves.toBe(false)
  })
})
