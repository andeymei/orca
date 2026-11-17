import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_SESSION_ATTACHMENT_MAX_BYTES } from '../../../../../../shared/agent-session/agent-session-attachments'
import { copyTerminalComposerAttachmentsToWorkspace } from './terminal-composer-workspace-copy'
import {
  dropTerminalComposerAttachments,
  pasteTerminalComposerAttachments,
  pickTerminalComposerAttachments,
  type TerminalComposerIntakeHost
} from './terminal-composer-attachment-intake'

vi.mock('./terminal-composer-workspace-copy', () => ({
  copyTerminalComposerAttachmentsToWorkspace: vi.fn()
}))

const copyMock = vi.mocked(copyTerminalComposerAttachmentsToWorkspace)
const pickAttachments = vi.fn<() => Promise<string[]>>()
const saveClipboardImageAsTempFile = vi.fn<() => Promise<string | null>>()
const stat =
  vi.fn<
    (args: { filePath: string }) => Promise<{ size: number; isDirectory: boolean; mtime: number }>
  >()
const getPathForFile = vi.fn<(file: File) => string>()

const host: TerminalComposerIntakeHost = {
  workspacePath: '/ws',
  worktreeId: 'w1'
}

const pngFile = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })
const textFile = new File([new Uint8Array([1])], 'notes.txt', { type: 'text/plain' })
const textItem: DataTransferItem = {
  kind: 'string',
  type: 'text/plain',
  getAsFile: () => null,
  getAsString: () => 'look at this',
  webkitGetAsEntry: () => null
}

beforeEach(() => {
  vi.clearAllMocks()
  copyMock.mockResolvedValue({ copied: [], skipped: [], failed: [] })
  pickAttachments.mockResolvedValue([])
  saveClipboardImageAsTempFile.mockResolvedValue(null)
  stat.mockResolvedValue({ size: 1024, isDirectory: false, mtime: 0 })
  getPathForFile.mockReturnValue('')
  vi.stubGlobal('window', {
    api: {
      shell: { pickAttachments },
      ui: { saveClipboardImageAsTempFile },
      fs: { stat, getPathForFile }
    }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('terminal composer attachment intake', () => {
  it('attaches the files the picker returned', async () => {
    pickAttachments.mockResolvedValue(['/tmp/a.txt'])
    copyMock.mockResolvedValue({
      copied: [{ sourcePath: '/tmp/a.txt', workspacePath: '/ws/.orca/drops/a.txt' }],
      skipped: [],
      failed: []
    })

    const result = await pickTerminalComposerAttachments(host)

    expect(copyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePaths: ['/tmp/a.txt'],
        workspacePath: '/ws',
        worktreeId: 'w1'
      })
    )
    expect(result.attachments).toEqual([
      {
        id: expect.any(String),
        name: 'a.txt',
        workspacePath: '/ws/.orca/drops/a.txt',
        isImage: false
      }
    ])
    expect(result.attachments[0].id).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.failed).toEqual([])
  })

  it('returns nothing when the picker is dismissed', async () => {
    pickAttachments.mockResolvedValue([])

    const result = await pickTerminalComposerAttachments(host)

    expect(result).toEqual({ attachments: [], failed: [] })
    expect(copyMock).not.toHaveBeenCalled()
  })

  it('keeps the image and the text from one clipboard paste', async () => {
    saveClipboardImageAsTempFile.mockResolvedValue('/tmp/orca-paste-1.png')
    copyMock.mockResolvedValue({
      copied: [
        { sourcePath: '/tmp/orca-paste-1.png', workspacePath: '/ws/.orca/drops/orca-paste-1.png' }
      ],
      skipped: [],
      failed: []
    })

    const result = await pasteTerminalComposerAttachments(host, {
      files: [pngFile],
      items: [textItem]
    })

    expect(result.attachments).toHaveLength(1)
    expect(result.attachments[0].isImage).toBe(true)
    expect(result.failed).toEqual([])
  })

  it('saves the pasted image on this machine before the copy carries it', async () => {
    saveClipboardImageAsTempFile.mockResolvedValue('/tmp/orca-paste-1.png')
    copyMock.mockResolvedValue({
      copied: [
        { sourcePath: '/tmp/orca-paste-1.png', workspacePath: '/ws/.orca/drops/orca-paste-1.png' }
      ],
      skipped: [],
      failed: []
    })

    await pasteTerminalComposerAttachments(host, { files: [pngFile] })

    expect(saveClipboardImageAsTempFile).toHaveBeenCalledWith()
    expect(copyMock).toHaveBeenCalledWith(
      expect.objectContaining({ sourcePaths: ['/tmp/orca-paste-1.png'] })
    )
  })

  it('reports a clipboard image this machine could not save', async () => {
    saveClipboardImageAsTempFile.mockRejectedValue(new Error('Clipboard image is too large'))

    const result = await pasteTerminalComposerAttachments(host, { files: [pngFile] })

    expect(result.attachments).toEqual([])
    expect(result.failed).toEqual([{ name: 'shot.png', reason: 'Clipboard image is too large' }])
    expect(copyMock).not.toHaveBeenCalled()
  })

  it('attaches a pasted file by its own local path', async () => {
    getPathForFile.mockReturnValue('/tmp/notes.txt')
    copyMock.mockResolvedValue({
      copied: [{ sourcePath: '/tmp/notes.txt', workspacePath: '/ws/.orca/drops/notes.txt' }],
      skipped: [],
      failed: []
    })

    const result = await pasteTerminalComposerAttachments(host, { files: [textFile] })

    expect(copyMock).toHaveBeenCalledWith(
      expect.objectContaining({ sourcePaths: ['/tmp/notes.txt'] })
    )
    expect(result.attachments).toEqual([
      {
        id: expect.any(String),
        name: 'notes.txt',
        workspacePath: '/ws/.orca/drops/notes.txt',
        isImage: false
      }
    ])
  })

  it('reports a failed upload without losing the other attachments', async () => {
    pickAttachments.mockResolvedValue(['/tmp/a.txt', '/tmp/b.png'])
    copyMock.mockResolvedValue({
      copied: [{ sourcePath: '/tmp/a.txt', workspacePath: '/ws/.orca/drops/a.txt' }],
      skipped: [],
      failed: [{ sourcePath: '/tmp/b.png', reason: 'disk full' }]
    })

    const result = await pickTerminalComposerAttachments(host)

    expect(result.attachments).toHaveLength(1)
    expect(result.failed).toEqual([{ name: 'b.png', reason: 'disk full' }])
  })

  it('reports a skipped source instead of dropping it', async () => {
    pickAttachments.mockResolvedValue(['/tmp/a.txt'])
    copyMock.mockResolvedValue({
      copied: [],
      skipped: [{ sourcePath: '/tmp/a.txt', reason: 'missing' }],
      failed: []
    })

    const result = await pickTerminalComposerAttachments(host)

    expect(result.attachments).toEqual([])
    expect(result.failed).toEqual([{ name: 'a.txt', reason: 'missing' }])
  })

  it('carries the renamed destination instead of the source', async () => {
    pickAttachments.mockResolvedValue(['/tmp/a.txt'])
    copyMock.mockResolvedValue({
      copied: [{ sourcePath: '/tmp/a.txt', workspacePath: '/ws/.orca/drops/a (1).txt' }],
      skipped: [],
      failed: []
    })

    const result = await pickTerminalComposerAttachments(host)

    expect(result.attachments).toEqual([
      {
        id: expect.any(String),
        name: 'a (1).txt',
        workspacePath: '/ws/.orca/drops/a (1).txt',
        isImage: false
      }
    ])
  })

  it('calls an extensionless image an image once the copy names it', async () => {
    pickAttachments.mockResolvedValue(['/tmp/Screenshot'])
    copyMock.mockResolvedValue({
      copied: [{ sourcePath: '/tmp/Screenshot', workspacePath: '/ws/.orca/drops/Screenshot.png' }],
      skipped: [],
      failed: []
    })

    const result = await pickTerminalComposerAttachments(host)

    expect(result.attachments).toEqual([
      {
        id: expect.any(String),
        name: 'Screenshot.png',
        workspacePath: '/ws/.orca/drops/Screenshot.png',
        isImage: true
      }
    ])
  })

  it('refuses a file over the attachment size limit before uploading it', async () => {
    pickAttachments.mockResolvedValue(['/tmp/big.bin', '/tmp/small.txt'])
    stat.mockImplementation(async ({ filePath }) => ({
      size: filePath === '/tmp/big.bin' ? AGENT_SESSION_ATTACHMENT_MAX_BYTES + 1 : 12,
      isDirectory: false,
      mtime: 0
    }))

    const result = await pickTerminalComposerAttachments(host)

    expect(copyMock).toHaveBeenCalledWith(
      expect.objectContaining({ sourcePaths: ['/tmp/small.txt'] })
    )
    expect(result.attachments).toEqual([])
    expect(result.failed).toEqual([
      {
        name: 'big.bin',
        reason: "'big.bin' is 52428801 bytes, over the 50 MiB attachment limit"
      }
    ])
  })

  it('drops the dropped paths into the workspace', async () => {
    copyMock.mockResolvedValue({
      copied: [{ sourcePath: '/tmp/a.png', workspacePath: '/ws/.orca/drops/a.png' }],
      skipped: [],
      failed: []
    })

    const result = await dropTerminalComposerAttachments(host, ['/tmp/a.png'])

    expect(copyMock).toHaveBeenCalledWith(expect.objectContaining({ sourcePaths: ['/tmp/a.png'] }))
    expect(result.attachments).toEqual([
      {
        id: expect.any(String),
        name: 'a.png',
        workspacePath: '/ws/.orca/drops/a.png',
        isImage: true
      }
    ])
  })

  it('forwards the owning host to the copy', async () => {
    pickAttachments.mockResolvedValue(['/tmp/a.txt'])
    const assertCurrent = vi.fn()

    await pickTerminalComposerAttachments({
      workspacePath: '/ws',
      worktreeId: 'w1',
      runtimeEnvironmentId: 'env-1',
      connectionId: 'c-1',
      expectedExecutionHostId: 'ssh:c-1',
      expectedSshTargetId: 't-1',
      expectedSshConnectionGeneration: 3,
      assertCurrent
    })

    expect(copyMock).toHaveBeenCalledWith({
      sourcePaths: ['/tmp/a.txt'],
      workspacePath: '/ws',
      worktreeId: 'w1',
      runtimeEnvironmentId: 'env-1',
      connectionId: 'c-1',
      expectedExecutionHostId: 'ssh:c-1',
      expectedSshTargetId: 't-1',
      expectedSshConnectionGeneration: 3,
      assertCurrent
    })
  })

  it('lets a host change reach the caller', async () => {
    pickAttachments.mockResolvedValue(['/tmp/a.txt'])
    copyMock.mockRejectedValue(new Error('Terminal upload host changed; retry the drop.'))

    await expect(pickTerminalComposerAttachments(host)).rejects.toThrow('host changed')
  })
})
