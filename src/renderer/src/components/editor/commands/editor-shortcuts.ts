import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { getShortcutPlatform } from '@/lib/keyboard/shortcut-platform'
import { useAppStore } from '@/store/index'
import { keybindingMatchesAction } from '../../../../../shared/keybindings/matching'
import type { KeybindingActionId } from '../../../../../shared/keybindings/types'
import type { NesTabDecision } from '../code-completion/nes-key-routing'

export function editorShortcutMatches(
  actionId: KeybindingActionId,
  event: KeyboardEvent | ReactKeyboardEvent
): boolean {
  return keybindingMatchesAction(
    actionId,
    event,
    getShortcutPlatform(),
    useAppStore.getState().keybindings
  )
}

export function installEditorSaveShortcut(target: HTMLElement, onSave: () => void): () => void {
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || !editorShortcutMatches('editor.save', event)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    onSave()
  }

  target.addEventListener('keydown', handleKeyDown, true)
  return () => target.removeEventListener('keydown', handleKeyDown, true)
}

export function installEditorFindShortcut(target: HTMLElement, onFind: () => void): () => void {
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (!editorShortcutMatches('editor.find', event)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    // Why: matched repeats must stay consumed so Monaco cannot reopen or reset find.
    if (!event.repeat) {
      onFind()
    }
  }

  target.addEventListener('keydown', handleKeyDown, true)
  return () => target.removeEventListener('keydown', handleKeyDown, true)
}

type MonacoDiffNavigationEditor = {
  getContainerDomNode: () => HTMLElement
  goToDiff: (target: 'next' | 'previous') => void
}

export function installMonacoDiffChangeNavigationShortcut(
  editor: MonacoDiffNavigationEditor
): () => void {
  const handleKeyDown = (event: KeyboardEvent): void => {
    let direction: 'next' | 'previous' | null = null
    if (editorShortcutMatches('editor.nextChange', event)) {
      direction = 'next'
    } else if (editorShortcutMatches('editor.previousChange', event)) {
      direction = 'previous'
    }
    if (!direction) {
      return
    }
    // Capture before Monaco opens its built-in F7 accessible-review pane.
    event.preventDefault()
    event.stopPropagation()
    // Consume matched repeats but navigate once per press (matches find shortcut).
    if (!event.repeat) {
      editor.goToDiff(direction)
    }
  }

  const target = editor.getContainerDomNode()
  target.addEventListener('keydown', handleKeyDown, true)
  return () => target.removeEventListener('keydown', handleKeyDown, true)
}

export function installEditorAddReviewNoteShortcut(
  target: HTMLElement,
  onAddReviewNote: () => boolean
): () => void {
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (!editorShortcutMatches('editor.addReviewNote', event)) {
      return
    }
    // Ignore held chords; mounted drafts consume repeats through installOpenDraftAddReviewNoteGuard.
    if (event.repeat) {
      return
    }
    // Leave the chord available to other bindings when this surface cannot open a composer.
    if (onAddReviewNote()) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  target.addEventListener('keydown', handleKeyDown, true)
  return () => target.removeEventListener('keydown', handleKeyDown, true)
}

/** Consume the chord and repeats within the composer subtree to prevent remounts without swallowing another pane’s shortcuts. */
export function installOpenDraftAddReviewNoteGuard(target: HTMLElement): () => void {
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (!editorShortcutMatches('editor.addReviewNote', event)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
  }

  target.addEventListener('keydown', handleKeyDown, true)
  return () => target.removeEventListener('keydown', handleKeyDown, true)
}

type MonacoFindShortcutEditor = {
  getAction: (id: string) => { run: () => void | Promise<void> } | null
  getContainerDomNode: () => HTMLElement
}

export function installMonacoEditorFindShortcut(editor: MonacoFindShortcutEditor): () => void {
  return installEditorFindShortcut(editor.getContainerDomNode(), () => {
    void editor.getAction('actions.find')?.run()
  })
}

/**
 * The Tab key of the next-edit suggestion: it accepts the suggestion, jumps to the next predicted
 * location, or leaves the key to the editor.
 */
export function installEditorAcceptAiSuggestionShortcut(
  target: HTMLElement,
  decide: () => NesTabDecision,
  onAccept: () => void,
  onJump: () => void,
  hasNextLocation: () => boolean
): () => void {
  // Why: a held chord repeats, and the repeats must keep the outcome of the press that started them.
  let consumedChord = false
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) {
      // Why: the repeats must not act again, and a consumed chord must not reach the suggest widget.
      if (consumedChord) {
        event.preventDefault()
        event.stopPropagation()
      }
      return
    }
    consumedChord = false
    if (editorShortcutMatches('editor.nextAiSuggestion', event)) {
      // Why: the chord belongs to other bindings when the feature has nowhere to jump to.
      if (!hasNextLocation()) {
        return
      }
      consumedChord = true
      event.preventDefault()
      event.stopPropagation()
      onJump()
      return
    }
    if (!editorShortcutMatches('editor.acceptAiSuggestion', event)) {
      return
    }
    const decision = decide()
    // Why: the suggest widget needs the key when there is nothing to accept or to jump to.
    if (decision === 'pass-through') {
      return
    }
    consumedChord = true
    event.preventDefault()
    event.stopPropagation()
    if (decision === 'accept-suggestion') {
      onAccept()
      return
    }
    onJump()
  }

  target.addEventListener('keydown', handleKeyDown, true)
  return () => target.removeEventListener('keydown', handleKeyDown, true)
}

/**
 * The chords that take a part of the suggestion: the next word and the next line.
 *
 * Why the chords are only taken while a suggestion shows: without one they belong to the editor,
 * and the arrow moves the cursor to the end of a word. A held chord keeps taking the next word,
 * which is what the key means on its own.
 */
export function installEditorAcceptNextAiSuggestionShortcut(
  target: HTMLElement,
  decide: () => NesTabDecision,
  onAcceptWord: () => void,
  onAcceptLine: () => void
): () => void {
  const handleKeyDown = (event: KeyboardEvent): void => {
    const isWord = editorShortcutMatches('editor.acceptNextAiSuggestionWord', event)
    const isLine = !isWord && editorShortcutMatches('editor.acceptNextAiSuggestionLine', event)
    if (!isWord && !isLine) {
      return
    }
    // Why: without a suggestion on screen the chord belongs to the editor.
    if (decide() !== 'accept-suggestion') {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (isWord) {
      onAcceptWord()
      return
    }
    onAcceptLine()
  }

  target.addEventListener('keydown', handleKeyDown, true)
  return () => target.removeEventListener('keydown', handleKeyDown, true)
}

/**
 * The held Alt that previews the predicted change. The modifier is only watched, never consumed,
 * because other chords need it.
 */
export function installEditorAiSuggestionPreviewShortcut(
  target: HTMLElement,
  onPreview: (active: boolean) => void
): () => void {
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || event.key !== 'Alt') {
      return
    }
    onPreview(true)
  }
  const handleKeyUp = (event: KeyboardEvent): void => {
    if (event.key !== 'Alt') {
      return
    }
    onPreview(false)
  }

  target.addEventListener('keydown', handleKeyDown, true)
  target.addEventListener('keyup', handleKeyUp, true)
  return () => {
    target.removeEventListener('keydown', handleKeyDown, true)
    target.removeEventListener('keyup', handleKeyUp, true)
  }
}
