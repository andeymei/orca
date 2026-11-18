// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import {
  TerminalComposerField,
  type TerminalComposerFieldHandle,
  type TerminalComposerFieldProps
} from './TerminalComposerField'

const initialState = useAppStore.getInitialState()

beforeEach(() => {
  useAppStore.setState(initialState, true)
})

afterEach(cleanup)

const host = { workspacePath: '/workspace', worktreeId: 'worktree-1' }

function setup(overrides: Partial<TerminalComposerFieldProps> = {}) {
  const onSend = vi.fn()
  const onAttach = vi.fn()
  const onDismiss = vi.fn()
  const view = render(
    <TerminalComposerField
      paneKey="tab1:leaf1"
      disabled={false}
      onSend={onSend}
      onAttach={onAttach}
      onDismiss={onDismiss}
      host={host}
      {...overrides}
    />
  )
  const editor = within(view.container).getByRole('textbox')
  return { ...view, editor, onSend, onAttach, onDismiss }
}

describe('terminal composer field', () => {
  it('turns Enter into a line break and never sends', () => {
    const { editor, onSend } = setup()
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
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

  it('claims a paste that carries a file', async () => {
    const { editor } = setup()
    const file = new File([new Uint8Array([1])], 'notes.txt', { type: 'text/plain' })
    await act(async () => {
      fireEvent.paste(editor, {
        clipboardData: { files: [file], items: [], getData: () => 'pasted text' }
      })
    })
    // The paste is claimed, so the editor inserted no text of its own.
    expect(editor.textContent).toBe('')
  })

  it('lets a plain-text paste reach the editor', () => {
    const { editor } = setup()
    const clipboardData = { files: [], items: [], getData: () => 'hello' }
    fireEvent.paste(editor, { clipboardData })
    // Nothing is claimed, so the editor's own paste handler inserted the text.
    expect(editor.textContent).toBe('hello')
  })

  it('names a file the way the agent reads it', async () => {
    const fieldRef = createRef<TerminalComposerFieldHandle>()
    render(
      <TerminalComposerField
        ref={fieldRef}
        paneKey="tab1:leaf1"
        disabled={false}
        onSend={vi.fn()}
        onAttach={vi.fn()}
        onDismiss={vi.fn()}
        host={{ workspacePath: '/workspace', worktreeId: 'worktree-1' }}
      />
    )
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
    const fieldRef = createRef<TerminalComposerFieldHandle>()
    render(
      <TerminalComposerField
        ref={fieldRef}
        paneKey="tab1:leaf1"
        disabled={false}
        onSend={vi.fn()}
        onAttach={vi.fn()}
        onDismiss={vi.fn()}
        host={{ workspacePath: '\\\\wsl.localhost\\Ubuntu\\workspace', worktreeId: 'worktree-1' }}
      />
    )
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
    const fieldRef = createRef<TerminalComposerFieldHandle>()
    render(
      <TerminalComposerField
        ref={fieldRef}
        paneKey="tab1:leaf1"
        disabled={false}
        onSend={vi.fn()}
        onAttach={vi.fn()}
        onDismiss={vi.fn()}
        host={host}
      />
    )
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
    // The file that landed stays in the body; the one that failed is marked.
    expect(fieldRef.current?.value()).toContain('@/workspace/.orca/drops/notes.txt')
    expect(screen.getByText('gone.txt')).toBeVisible()
    expect(screen.getByText('Attach it again')).toBeVisible()
  })
})
