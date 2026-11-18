// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { Worktree } from '../../../../../shared/worktree/types'
import { joinRuntimeTerminalDropDir } from '../input/file-drop/terminal-drop-worktree-path'
import { pasteTerminalComposerAttachments } from './attachments/terminal-composer-attachment-intake'
import { TerminalComposerOverlay } from './TerminalComposerOverlay'

vi.mock('./attachments/terminal-composer-attachment-intake', () => ({
  pasteTerminalComposerAttachments: vi.fn(),
  pickTerminalComposerAttachments: vi.fn(),
  dropTerminalComposerAttachments: vi.fn()
}))

const PANE_ID = 1
const LEAF_ID = 'leaf-1'
const TAB_ID = 'tab-1'
const PANE_KEY = `${TAB_ID}:${LEAF_ID}`
const WORKTREE_PATH = '/worktrees/wt-1'

const initialState = useAppStore.getInitialState()

function makeWorktree(id: string, path: string): Worktree {
  return {
    id,
    repoId: 'repo-1',
    displayName: id,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    path,
    head: 'HEAD',
    branch: 'main',
    isBare: false,
    isMainWorktree: false
  }
}

function createOverlay(cwd = '/workspace') {
  const sendInput = vi.fn(() => true)
  const pane = { id: PANE_ID, leafId: LEAF_ID }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fake answers only the pane queries the send layer makes.
  const manager = { getPanes: () => [pane] } as never
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fake answers only the transport queries the send layer makes.
  const transport = {
    sendInput,
    getPtyId: () => 'pty-1',
    isConnected: () => true,
    getExecutionHostId: () => 'local',
    getRuntimeEnvironmentId: () => null,
    getLocalSessionMetadata: () => ({ cwd })
  } as never
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fake map holds the one transport the send layer looks up.
  const paneTransports = new Map([[PANE_ID, transport]]) as never
  const managerRef = { current: manager }
  const paneTransportsRef = { current: paneTransports }
  const view = render(
    <TerminalComposerOverlay
      paneKey={PANE_KEY}
      paneId={PANE_ID}
      leafId={LEAF_ID}
      tabId={TAB_ID}
      cwd={cwd}
      worktreeId="worktree-1"
      agent="claude"
      managerRef={managerRef}
      paneTransportsRef={paneTransportsRef}
    />
  )
  return { ...view, sendInput }
}

beforeEach(() => {
  // The send waits between its writes; fake timers keep the suite from waiting for them.
  vi.useFakeTimers()
  useAppStore.setState(initialState, true)
  useAppStore.setState({ terminalComposerOpenByPaneKey: { [PANE_KEY]: true } })
  vi.mocked(pasteTerminalComposerAttachments).mockResolvedValue({ attachments: [], failed: [] })
})

afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('terminal composer overlay', () => {
  it('writes nothing when there is nothing to send', async () => {
    const { container, sendInput } = createOverlay()
    const editor = within(container).getByRole('textbox')
    await act(async () => {
      fireEvent.keyDown(editor, { key: 'Enter', metaKey: true })
    })
    // An empty message must not clear the terminal's input line, nor press Enter.
    expect(sendInput).not.toHaveBeenCalled()
  })

  it('writes the body of a message that has one', async () => {
    useAppStore.setState({
      terminalComposerDraftByPaneKey: {
        [PANE_KEY]: {
          document: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }]
          },
          attachments: []
        }
      }
    })
    const { container, sendInput } = createOverlay()
    const editor = within(container).getByRole('textbox')
    await act(async () => {
      fireEvent.keyDown(editor, { key: 'Enter', metaKey: true })
    })
    // The write path is reached: the fake transport answers the clear first.
    expect(sendInput).toHaveBeenCalled()
  })

  it('lands a pasted file in the worktree that owns the terminal, not in the cwd', async () => {
    useAppStore.setState({
      worktreesByRepo: { 'repo-1': [makeWorktree('worktree-1', WORKTREE_PATH)] }
    })
    const { container } = createOverlay('/cwd')
    const editor = within(container).getByRole('textbox')
    const file = new File([new Uint8Array([1])], 'notes.txt', { type: 'text/plain' })
    await act(async () => {
      fireEvent.paste(editor, {
        clipboardData: { files: [file], items: [], getData: () => '' }
      })
    })
    // The host comes from the pane's transport, so the worktree owns the attachment.
    const host = vi.mocked(pasteTerminalComposerAttachments).mock.calls[0]?.[0]
    expect(host?.workspacePath).toBe(WORKTREE_PATH)
    // The attachment lands in that worktree's staging directory, not in the cwd's.
    expect(joinRuntimeTerminalDropDir(host?.workspacePath ?? '')).toBe(
      `${WORKTREE_PATH}/.orca/drops`
    )
  })
})
