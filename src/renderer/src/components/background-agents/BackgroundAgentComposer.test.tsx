// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BackgroundAgentComposer,
  type BackgroundAgentComposerHandle
} from './BackgroundAgentComposer'

const intake = vi.hoisted(() => ({
  pick: vi.fn(),
  paste: vi.fn()
}))

vi.mock(
  '@/components/terminal-pane/composer/attachments/terminal-composer-attachment-intake',
  () => ({
    pickTerminalComposerAttachments: intake.pick,
    pasteTerminalComposerAttachments: intake.paste
  })
)

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({
  toast: Object.assign(toastError, { error: toastError, success: vi.fn(), info: vi.fn() })
}))

const host = { workspacePath: '/workspace', worktreeId: 'worktree-1' }

beforeEach(() => {
  intake.pick.mockReset()
  intake.paste.mockReset()
  toastError.mockClear()
  intake.pick.mockResolvedValue({ attachments: [], failed: [] })
  intake.paste.mockResolvedValue({ attachments: [], failed: [] })
})

afterEach(cleanup)

function setup(): {
  editor: HTMLElement
  handle: React.RefObject<BackgroundAgentComposerHandle | null>
  onSend: ReturnType<typeof vi.fn>
  onCommand: ReturnType<typeof vi.fn>
  onDismiss: ReturnType<typeof vi.fn>
} {
  const onSend = vi.fn()
  const onCommand = vi.fn()
  const onDismiss = vi.fn()
  const handle = createRef<BackgroundAgentComposerHandle>()
  render(
    <BackgroundAgentComposer
      ref={handle}
      onSend={onSend}
      onCommand={onCommand}
      onDismiss={onDismiss}
      buildHost={() => host}
    />
  )
  const editor = screen.getByRole('textbox')
  return { editor, handle, onSend, onCommand, onDismiss }
}

/** Types into the editor the way a paste does, which is the only way a test can type. */
async function type(editor: HTMLElement, text: string): Promise<void> {
  await act(async () => {
    fireEvent.paste(editor, {
      clipboardData: { files: [], items: [], getData: () => text }
    })
  })
}

describe('the background agents composer', () => {
  it('turns Enter into a line break and never sends', async () => {
    const { editor, onSend, handle } = setup()
    await type(editor, 'do the thing')
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
    // The line broke instead.
    expect(handle.current?.prompt()).toBe('do the thing\n')
  })

  it('sends on Mod+Enter', async () => {
    const { editor, onSend } = setup()
    await type(editor, 'do the thing')
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true })
    expect(onSend).toHaveBeenCalledOnce()
    expect(onSend).toHaveBeenCalledWith('do the thing')
  })

  it('sends nothing while an upload is still on its way', async () => {
    intake.paste.mockImplementation(() => new Promise(() => {}))
    const { editor, onSend } = setup()
    const file = new File([new Uint8Array([1])], 'notes.txt', { type: 'text/plain' })
    await act(async () => {
      fireEvent.paste(editor, {
        clipboardData: { files: [file], items: [], getData: () => '' }
      })
    })
    // The file would be dropped from the message, so the send waits for it.
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('clears the box on Escape', async () => {
    const { editor, onDismiss, handle } = setup()
    await type(editor, 'do the thing')
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(handle.current?.prompt()).toBe('')
    // The box had something to clear, so the list keeps the keys.
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('hands the keys to the list when the box has nothing to clear', async () => {
    const { editor, onDismiss } = setup()
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('arms the stop with ctrl+x', () => {
    const { editor, onCommand } = setup()
    fireEvent.keyDown(editor, { key: 'x', ctrlKey: true })
    expect(onCommand).toHaveBeenCalledOnce()
  })

  it('lets the native cut win when the editor has a selection', async () => {
    const { editor, onCommand } = setup()
    await type(editor, 'do the thing')
    // The editor selects its own text; the platform's own shortcut is the one that does it.
    fireEvent.keyDown(editor, { key: 'a', metaKey: true })
    fireEvent.keyDown(editor, { key: 'a', ctrlKey: true })
    fireEvent.keyDown(editor, { key: 'x', ctrlKey: true })
    expect(onCommand).not.toHaveBeenCalled()
  })

  it('names the file it attached, and the prompt carries the path', async () => {
    intake.pick.mockResolvedValue({
      attachments: [
        {
          id: 'a1',
          name: 'notes.txt',
          workspacePath: '/workspace/.orca/drops/notes.txt',
          isImage: false
        }
      ],
      failed: []
    })
    const { handle } = setup()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add attachment' }))
    })
    // The body names the file where the agent reads it.
    expect(handle.current?.prompt()).toBe('@/workspace/.orca/drops/notes.txt ')
  })

  it('names the image it attached, because the prompt can only carry a path', async () => {
    intake.pick.mockResolvedValue({
      attachments: [
        {
          id: 'a1',
          name: 'shot.png',
          workspacePath: '/workspace/.orca/drops/shot.png',
          isImage: true
        }
      ],
      failed: []
    })
    const { handle } = setup()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add attachment' }))
    })
    expect(handle.current?.prompt()).toBe('@/workspace/.orca/drops/shot.png ')
  })

  it('says so when a file does not land', async () => {
    intake.pick.mockResolvedValue({
      attachments: [],
      failed: [{ name: 'gone.txt', reason: 'missing' }]
    })
    setup()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add attachment' }))
    })
    expect(screen.getByText('gone.txt')).toBeVisible()
    expect(screen.getByText('The file is gone')).toBeVisible()
  })

  it('refuses to attach a file when the host takes none', async () => {
    const onSend = vi.fn()
    render(
      <BackgroundAgentComposer
        onSend={onSend}
        onCommand={vi.fn()}
        onDismiss={vi.fn()}
        buildHost={() => null}
      />
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add attachment' }))
    })
    expect(intake.pick).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledTimes(1)
  })
})
