import type { StateCreator } from 'zustand'
import type { JSONContent } from '@tiptap/react'
import type { AppState } from '../../types'

export type TerminalComposerAttachment = {
  id: string
  name: string
  /** Where the bytes landed, on the host that owns this terminal. Null while uploading or after a failure. */
  workspacePath: string | null
  isImage: boolean
  /** The upload did not land; the user must attach it again. */
  failed?: boolean
}

export type TerminalComposerDraft = {
  document: JSONContent
  attachments: TerminalComposerAttachment[]
}

/** The composer's state per terminal pane. The draft lives in memory only; it is never persisted. */
export type TerminalComposerSlice = {
  terminalComposerOpenByPaneKey: Record<string, boolean>
  terminalComposerDraftByPaneKey: Record<string, TerminalComposerDraft>
  setTerminalComposerOpen: (paneKey: string, open: boolean) => void
  toggleTerminalComposer: (paneKey: string) => void
  setTerminalComposerDraft: (paneKey: string, draft: TerminalComposerDraft) => void
  clearTerminalComposerDraft: (paneKey: string) => void
}

export const createTerminalComposerSlice: StateCreator<AppState, [], [], TerminalComposerSlice> = (
  set
) => ({
  terminalComposerOpenByPaneKey: {},
  terminalComposerDraftByPaneKey: {},

  setTerminalComposerOpen: (paneKey, open) =>
    set((prev) => ({
      terminalComposerOpenByPaneKey: { ...prev.terminalComposerOpenByPaneKey, [paneKey]: open }
    })),

  toggleTerminalComposer: (paneKey) =>
    set((prev) => ({
      terminalComposerOpenByPaneKey: {
        ...prev.terminalComposerOpenByPaneKey,
        [paneKey]: !prev.terminalComposerOpenByPaneKey[paneKey]
      }
    })),

  setTerminalComposerDraft: (paneKey, draft) =>
    set((prev) => ({
      terminalComposerDraftByPaneKey: { ...prev.terminalComposerDraftByPaneKey, [paneKey]: draft }
    })),

  clearTerminalComposerDraft: (paneKey) =>
    set((prev) => {
      if (!Object.hasOwn(prev.terminalComposerDraftByPaneKey, paneKey)) {
        return prev
      }
      const drafts = { ...prev.terminalComposerDraftByPaneKey }
      delete drafts[paneKey]
      return { terminalComposerDraftByPaneKey: drafts }
    })
})
