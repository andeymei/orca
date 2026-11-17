import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importExternalPathsToRuntime } from '@/runtime/files/imports/runtime-file-import-client'
import {
  copyTerminalComposerAttachmentsToWorkspace,
  terminalComposerDropDir
} from './terminal-composer-workspace-copy'

vi.mock('@/runtime/files/imports/runtime-file-import-client', () => ({
  importExternalPathsToRuntime: vi.fn()
}))

const importMock = vi.mocked(importExternalPathsToRuntime)
const writeFile = vi.fn<(args: { filePath: string; content: string }) => Promise<unknown>>()

beforeEach(() => {
  vi.clearAllMocks()
  writeFile.mockResolvedValue({ ok: true })
  vi.stubGlobal('window', { api: { fs: { writeFile } } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const localRequest = {
  sourcePaths: ['/tmp/a.txt'],
  workspacePath: '/ws',
  worktreeId: 'w1'
}

describe('terminal composer workspace copy', () => {
  it('copies into the workspace drop staging directory', async () => {
    importMock.mockResolvedValue({
      results: [
        {
          sourcePath: '/tmp/a.txt',
          status: 'imported',
          destPath: '/ws/.orca/drops/a.txt',
          kind: 'file',
          renamed: false
        }
      ]
    })

    const result = await copyTerminalComposerAttachmentsToWorkspace(localRequest)

    expect(importMock).toHaveBeenCalledWith(
      expect.anything(),
      ['/tmp/a.txt'],
      '/ws/.orca/drops',
      expect.objectContaining({ ensureDestinationDir: true })
    )
    expect(result.copied).toEqual([
      { sourcePath: '/tmp/a.txt', workspacePath: '/ws/.orca/drops/a.txt' }
    ])
  })

  it('reports a skipped source without failing the others', async () => {
    importMock.mockResolvedValue({
      results: [
        { sourcePath: '/tmp/a', status: 'skipped', reason: 'unsupported' },
        {
          sourcePath: '/tmp/b',
          status: 'imported',
          destPath: '/ws/.orca/drops/b',
          kind: 'file',
          renamed: false
        }
      ]
    })

    const result = await copyTerminalComposerAttachmentsToWorkspace({
      ...localRequest,
      sourcePaths: ['/tmp/a', '/tmp/b']
    })

    expect(result.skipped).toEqual([{ sourcePath: '/tmp/a', reason: 'unsupported' }])
    expect(result.copied).toHaveLength(1)
  })

  it('reports a failed source without failing the others', async () => {
    importMock.mockResolvedValue({
      results: [
        { sourcePath: '/tmp/a', status: 'failed', reason: 'disk full' },
        {
          sourcePath: '/tmp/b',
          status: 'imported',
          destPath: '/ws/.orca/drops/b',
          kind: 'file',
          renamed: false
        }
      ]
    })

    const result = await copyTerminalComposerAttachmentsToWorkspace({
      ...localRequest,
      sourcePaths: ['/tmp/a', '/tmp/b']
    })

    expect(result.failed).toEqual([{ sourcePath: '/tmp/a', reason: 'disk full' }])
    expect(result.copied).toHaveLength(1)
  })

  it('gives a deconflicted copy its own path', async () => {
    importMock.mockResolvedValue({
      results: [
        {
          sourcePath: '/tmp/a.txt',
          status: 'imported',
          destPath: '/ws/.orca/drops/a (1).txt',
          kind: 'file',
          renamed: true
        }
      ]
    })

    const result = await copyTerminalComposerAttachmentsToWorkspace(localRequest)

    expect(result.copied[0].workspacePath).toBe('/ws/.orca/drops/a (1).txt')
  })

  it('propagates a host change instead of reporting a copied file', async () => {
    importMock.mockImplementation(async (_context, _sourcePaths, _destDir, options) => {
      options?.assertCurrent?.()
      return { results: [] }
    })

    await expect(
      copyTerminalComposerAttachmentsToWorkspace({
        ...localRequest,
        assertCurrent: () => {
          throw new Error('Terminal upload host changed; retry the drop.')
        }
      })
    ).rejects.toThrow('host changed')
  })

  it('keeps the copied workspace out of git status', async () => {
    importMock.mockResolvedValue({
      results: [
        {
          sourcePath: '/tmp/a.txt',
          status: 'imported',
          destPath: '/ws/.orca/drops/a.txt',
          kind: 'file',
          renamed: false
        }
      ]
    })

    await copyTerminalComposerAttachmentsToWorkspace(localRequest)

    expect(writeFile).toHaveBeenCalledWith({
      filePath: '/ws/.orca/drops/.gitignore',
      content: '*\n'
    })
  })

  it('leaves the runtime copy ignore file to the runtime that owns it', async () => {
    importMock.mockResolvedValue({
      results: [
        {
          sourcePath: '/tmp/a.txt',
          status: 'imported',
          destPath: '/ws/.orca/drops/a.txt',
          kind: 'file',
          renamed: false
        }
      ]
    })

    await copyTerminalComposerAttachmentsToWorkspace({
      ...localRequest,
      runtimeEnvironmentId: 'env-1'
    })

    expect(importMock).toHaveBeenCalledWith(
      expect.objectContaining({ target: { kind: 'environment', environmentId: 'env-1' } }),
      ['/tmp/a.txt'],
      '/ws/.orca/drops',
      expect.anything()
    )
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('keeps a failed ignore file from failing the attachments', async () => {
    importMock.mockResolvedValue({
      results: [
        {
          sourcePath: '/tmp/a.txt',
          status: 'imported',
          destPath: '/ws/.orca/drops/a.txt',
          kind: 'file',
          renamed: false
        }
      ]
    })
    writeFile.mockRejectedValue(new Error('read-only file system'))

    const result = await copyTerminalComposerAttachmentsToWorkspace(localRequest)

    expect(result.copied).toEqual([
      { sourcePath: '/tmp/a.txt', workspacePath: '/ws/.orca/drops/a.txt' }
    ])
  })

  it('drops into a Windows workspace without mixing separators', () => {
    expect(terminalComposerDropDir('C:\\ws')).toBe('C:\\ws\\.orca\\drops')
  })
})
