import { useCallback } from 'react'
import { useAppStore } from '@/store'
import type { TerminalComposerDraft } from '@/store/slices/terminal-composer/terminal-composer'

/** The draft a pane has not written yet: one empty paragraph and no attachments. */
export const EMPTY_TERMINAL_COMPOSER_DRAFT: TerminalComposerDraft = {
  document: { type: 'doc', content: [{ type: 'paragraph' }] },
  attachments: []
}

/** The draft as it stands right now; a write replaces it whole, so it is read at write time. */
export function readTerminalComposerDraft(paneKey: string): TerminalComposerDraft {
  return (
    useAppStore.getState().terminalComposerDraftByPaneKey[paneKey] ?? EMPTY_TERMINAL_COMPOSER_DRAFT
  )
}

export function useTerminalComposerState(paneKey: string): {
  open: boolean
  draft: TerminalComposerDraft
  setOpen: (open: boolean) => void
  toggle: () => void
  saveDraft: (draft: TerminalComposerDraft) => void
} {
  const open = useAppStore((state) => state.terminalComposerOpenByPaneKey[paneKey] === true)
  const draft = useAppStore(
    (state) => state.terminalComposerDraftByPaneKey[paneKey] ?? EMPTY_TERMINAL_COMPOSER_DRAFT
  )
  const setOpen = useCallback(
    (next: boolean) => {
      useAppStore.getState().setTerminalComposerOpen(paneKey, next)
    },
    [paneKey]
  )
  const toggle = useCallback(() => {
    useAppStore.getState().toggleTerminalComposer(paneKey)
  }, [paneKey])
  const saveDraft = useCallback(
    (next: TerminalComposerDraft) => {
      useAppStore.getState().setTerminalComposerDraft(paneKey, next)
    },
    [paneKey]
  )
  return { open, draft, setOpen, toggle, saveDraft }
}
