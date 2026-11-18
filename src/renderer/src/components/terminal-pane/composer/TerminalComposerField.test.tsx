// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { pasteTerminalComposerAttachments } from './attachments/terminal-composer-attachment-intake'
import {
  TerminalComposerField,
  type TerminalComposerFieldHandle,
  type TerminalComposerFieldProps
} from './TerminalComposerField'

vi.mock('./attachments/terminal-composer-attachment-intake', () => ({
  pasteTerminalComposerAttachments: vi.fn()
}))

const pasteIntake = vi.mocked(pasteTerminalComposerAttachments)
const initialState = useAppStore.getInitialState()

const host = { workspacePath: '/workspace', worktreeId: 'worktree-1' }

beforeEach(() => {
  useAppStore.setState(initialState, true)
  pasteIntake.mockResolvedValue({
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
})

afterEach(cleanup)

function setup(overrides: Partial<TerminalComposerFieldProps> = {}) {
  const onSend = vi.fn()
  const onAttach = vi.fn()
  const onDismiss = vi.fn()
  const onDrop = vi.fn()
  const fieldRef = createRef<TerminalComposerFieldHandle>()
  const view = render(
    <TerminalComposerField
      ref={fieldRef}
      paneKey="tab1:leaf1"
      disabled={false}
      onSend={onSend}
      onAttach={onAttach}
      onDismiss={onDismiss}
      buildHost={() => host}
      onDrop={onDrop}
      {...overrides}
    />
  )
  const editor = within(view.container).getByRole('textbox')
  return { ...view, editor, fieldRef, onSend, onAttach, onDismiss, onDrop }
}

describe('terminal composer field', () => {
  it('turns Enter into a line break and never sends', () => {
    const { editor, fieldRef, onSend } = setup()
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
    // The line broke instead.
    expect(fieldRef.current?.value()).toBe('\n')
  })

  it('sends on Mod+Enter', () => {
    const { editor, onSend } = setup()
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true })
    expect(onSend).toHaveBeenCalledOnce()
  })

  it('does not send while an IME composition is open', () => {
    const { editor, onSend } = setup()
    fireEvent.keyDown(editor, { key: 'Enter', keyCode: 229 })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('closes the composer on Escape', () => {
    const { editor, onDismiss } = setup()
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('asks the parent to attach when the paperclip is pressed', () => {
    const { onAttach } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Add attachment' }))
    expect(onAttach).toHaveBeenCalledOnce()
  })

  it('lands the file of a paste and keeps the text of the paste', async () => {
    const { editor, fieldRef } = setup()
    const file = new File([new Uint8Array([1])], 'notes.txt', { type: 'text/plain' })
    await act(async () => {
      fireEvent.paste(editor, {
        clipboardData: { files: [file], items: [], getData: () => 'look at this' }
      })
    })
    // The text half is the body; the file half is an attachment.
    expect(fieldRef.current?.value()).toContain('look at this')
    expect(fieldRef.current?.value()).toContain('@/workspace/.orca/drops/notes.txt')
  })

  it('leaves out the text that only labels the copied files', async () => {
    const { editor, fieldRef } = setup()
    const file = new File([new Uint8Array([1])], 'notes.txt', { type: 'text/plain' })
    await act(async () => {
      fireEvent.paste(editor, {
        clipboardData: { files: [file], items: [], getData: () => 'notes.txt' }
      })
    })
    // The file's own name labels the file; it is not body text.
    expect(fieldRef.current?.value()).toBe('@/workspace/.orca/drops/notes.txt ')
  })

  it('lets a plain-text paste reach the editor', () => {
    const { editor } = setup()
    const clipboardData = { files: [], items: [], getData: () => 'hello' }
    fireEvent.paste(editor, { clipboardData })
    // Nothing is claimed, so the editor's own paste handler inserted the text.
    expect(editor.textContent).toBe('hello')
  })

  it('names a file the way the agent reads it', async () => {
    const { fieldRef } = setup()
    await act(async () => {
      fieldRef.current?.landAttachments({
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
    })
    // The body names the file where the agent reads it.
    expect(fieldRef.current?.value()).toContain('@/workspace/.orca/drops/notes.txt')
  })

  it('spells a WSL file the way the WSL agent reads it', async () => {
    const { fieldRef } = setup({
      buildHost: () => ({
        workspacePath: '\\\\wsl.localhost\\Ubuntu\\workspace',
        worktreeId: 'worktree-1'
      })
    })
    await act(async () => {
      fieldRef.current?.landAttachments({
        attachments: [
          {
            id: 'a1',
            name: 'notes.txt',
            workspacePath: '\\\\wsl.localhost\\Ubuntu\\workspace\\.orca\\drops\\notes.txt',
            isImage: false
          }
        ],
        failed: []
      })
    })
    // A WSL agent cannot read the Windows spelling of its own file.
    expect(fieldRef.current?.value()).toContain('@/workspace/.orca/drops/notes.txt')
  })

  it('keeps the attachments that landed when one of them fails', async () => {
    const { fieldRef } = setup()
    await act(async () => {
      fieldRef.current?.landAttachments({
        attachments: [
          {
            id: 'a1',
            name: 'notes.txt',
            workspacePath: '/workspace/.orca/drops/notes.txt',
            isImage: false
          }
        ],
        failed: [{ name: 'gone.txt', reason: 'missing' }]
      })
    })
    // The file that landed stays in the body; the one that failed says why.
    expect(fieldRef.current?.value()).toContain('@/workspace/.orca/drops/notes.txt')
    expect(screen.getByText('gone.txt')).toBeVisible()
    expect(screen.getByText('The file is gone')).toBeVisible()
    // The re-add hint is visible, not only a hover title.
    expect(screen.getByText('Attach it again')).toBeVisible()
  })

  it('disables the send button while there is nothing to send', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('enables the send button for a message that carries only a file', () => {
    useAppStore.setState({
      terminalComposerDraftByPaneKey: {
        'tab1:leaf1': {
          document: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'nativeChatFileReference', attrs: { token: '@/a.txt', path: '/a.txt' } }
                ]
              }
            ]
          },
          attachments: []
        }
      }
    })
    setup()
    // A message that names a file is worth sending.
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })
})
