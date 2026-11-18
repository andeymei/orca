import type { StateCreator } from 'zustand'
import type { JSONContent } from '@tiptap/react'
import { parsePaneKey } from '../../../../../shared/workspace-layout/stable-pane-id'
import type { AppState } from '../../types'

export type TerminalComposerAttachment = {
  id: string
  name: string
  /** Where the bytes landed, on the host that owns this terminal. Null while uploading or after a failure. */
  workspacePath: string | null
  isImage: boolean
  /** The upload did not land; the user must attach it again. */
  failed?: boolean
  /** Why the upload did not land; the chip says it in words. */
  reason?: string
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
  /** Drops one pane's draft and open flag. */
  clearTerminalComposerPane: (paneKey: string) => void
  /** Drops every draft and open flag this tab's panes owned. */
  clearTerminalComposerStateForTab: (tabId: string) => void
}

/** The pane keys a tab owns, read from each key's own tab id. */
function paneKeysOfTab(record: Record<string, unknown>, tabId: string): string[] {
  return Object.keys(record).filter((paneKey) => parsePaneKey(paneKey)?.tabId === tabId)
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
    }),

  clearTerminalComposerPane: (paneKey) =>
    set((prev) => {
      if (
        !Object.hasOwn(prev.terminalComposerDraftByPaneKey, paneKey) &&
        !Object.hasOwn(prev.terminalComposerOpenByPaneKey, paneKey)
      ) {
        return prev
      }
      const drafts = { ...prev.terminalComposerDraftByPaneKey }
      delete drafts[paneKey]
      const open = { ...prev.terminalComposerOpenByPaneKey }
      delete open[paneKey]
      return { terminalComposerDraftByPaneKey: drafts, terminalComposerOpenByPaneKey: open }
    }),

  clearTerminalComposerStateForTab: (tabId) =>
    set((prev) => {
      const doomed = new Set([
        ...paneKeysOfTab(prev.terminalComposerDraftByPaneKey, tabId),
        ...paneKeysOfTab(prev.terminalComposerOpenByPaneKey, tabId)
      ])
      if (doomed.size === 0) {
        return prev
      }
      const drafts = { ...prev.terminalComposerDraftByPaneKey }
      const open = { ...prev.terminalComposerOpenByPaneKey }
      for (const paneKey of doomed) {
        delete drafts[paneKey]
        delete open[paneKey]
      }
      return { terminalComposerDraftByPaneKey: drafts, terminalComposerOpenByPaneKey: open }
    })
})
