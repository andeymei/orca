import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const { gitExecFileAsyncMock } = vi.hoisted(() => ({
  gitExecFileAsyncMock: vi.fn()
}))

vi.mock('../git/command-runner/git-exec-file', () => ({
  gitExecFileAsync: gitExecFileAsyncMock
}))

import { excludeRefactorScratchFromGit } from './refactor-git-exclude'

const roots: string[] = []

async function workspaceRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'refactor-exclude-'))
  roots.push(root)
  return root
}

describe('excludeRefactorScratchFromGit', () => {
  afterEach(async () => {
    gitExecFileAsyncMock.mockReset()
    for (const root of roots.splice(0)) {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('appends the scratch entry to the exclude file git names', async () => {
    const root = await workspaceRoot()
    const excludePath = path.join(root, 'git', 'info', 'exclude')
    await fs.mkdir(path.dirname(excludePath), { recursive: true })
    await fs.writeFile(excludePath, 'other/\n')
    gitExecFileAsyncMock.mockResolvedValue({ stdout: `${excludePath}\n`, stderr: '' })

    await excludeRefactorScratchFromGit(root)

    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(['rev-parse', '--git-path', 'info/exclude'], {
      cwd: root
    })
    expect(await fs.readFile(excludePath, 'utf8')).toBe('other/\n.orca/refactor/\n')
  })

  it('does not append the entry twice', async () => {
    const root = await workspaceRoot()
    const excludePath = path.join(root, 'exclude')
    await fs.writeFile(excludePath, '.orca/refactor/\n')
    gitExecFileAsyncMock.mockResolvedValue({ stdout: excludePath, stderr: '' })

    await excludeRefactorScratchFromGit(root)

    expect(await fs.readFile(excludePath, 'utf8')).toBe('.orca/refactor/\n')
  })

  it('keeps quiet when the workspace is not a git repository', async () => {
    const root = await workspaceRoot()
    gitExecFileAsyncMock.mockRejectedValue(new Error('not a git repository'))
    await expect(excludeRefactorScratchFromGit(root)).resolves.toBeUndefined()
  })
})
