import { useEffect, useRef } from 'react'
import { editor, type IPosition } from 'monaco-editor/esm/vs/editor/editor.api.js'
import type { RuntimeFileOperationArgs } from '@/runtime/files/runtime-file-client-types'
import type { NesEdit } from '../../../../../shared/code-completion/code-completion-types'
import { buildNesContext } from './nes-context-builder'
import { applyNesEdit, previewNesEdit } from './nes-edit-application'
import { fireNesInlineCompletionsChanged, nesInlineCompletionForEdit } from './nes-inline-provider'
import { decideNesTabAction, type NesTabDecision } from './nes-key-routing'
import {
  createNesMarkerDecorations,
  nesLocationMarkers,
  nesMarkerDecorations,
  type NesLocationMarker
} from './nes-location-markers'
import { nesPlanStore } from './nes-plan-store'
import { collectNesRelatedFiles } from './nes-related-files'
import { requestNesPlan } from './nes-runtime-client'

/** What the editor's shortcut installers call; the hook publishes them for its own editor. */
export type NesShortcutHandlers = {
  decide: () => NesTabDecision
  accept: () => void
  jump: () => void
  preview: (active: boolean) => void
}

const handlersByEditor = new WeakMap<editor.IStandaloneCodeEditor, NesShortcutHandlers>()

/** The handlers of the editor that owns the feature, or null when the feature is off there. */
export function nesShortcutHandlersFor(
  editorInstance: editor.IStandaloneCodeEditor
): NesShortcutHandlers | null {
  return handlersByEditor.get(editorInstance) ?? null
}

/**
 * The trigger of the next-edit suggestion: it watches the editor, asks for a plan and keeps the
 * plan, the gutter markers and the shortcuts in step with it.
 */
export function useMonacoNextEditSuggestions(params: {
  filePath: string | undefined
  relativePath: string | undefined
  languageId: string
  enabled: boolean
  triggerDelayMs: number
  /** The extensions the feature is on for; a file outside the list is skipped whole. */
  enabledExtensions: readonly string[]
  /** The live editor — the hook needs its model, its cursor and its decoration collection. */
  editorInstance: editor.IStandaloneCodeEditor | null
  /** The worktree that owns the file, for the related-file search; null when it cannot be resolved. */
  files: RuntimeFileOperationArgs | null
}): void {
  const {
    filePath,
    relativePath,
    languageId,
    enabled,
    triggerDelayMs,
    enabledExtensions,
    editorInstance,
    files
  } = params
  // Why: the request cannot be cancelled end to end, so a late answer is dropped by its generation.
  const generationRef = useRef(0)
  // Why: the provider asks the store by the model's own URI, so the binding has to carry that key.
  const modelKey = editorInstance?.getModel()?.uri.toString() ?? null

  useEffect(() => {
    // Why: an unbound model finds no plan, so a plan left over from a switched-off feature cannot show.
    if (!modelKey || !filePath || !enabled) {
      return
    }
    if (!isExtensionEnabled(filePath, enabledExtensions)) {
      return
    }
    nesPlanStore.bindModel(modelKey, filePath)
    return () => {
      nesPlanStore.unbindModel(modelKey)
    }
  }, [modelKey, filePath, enabled, enabledExtensions])

  useEffect(() => {
    if (!editorInstance || !modelKey || !filePath || !enabled) {
      return
    }
    if (!isExtensionEnabled(filePath, enabledExtensions)) {
      return
    }

    let timer: ReturnType<typeof setTimeout> | null = null
    let previewRelease: (() => void) | null = null
    let markers: NesLocationMarker[] = []
    const collection = createNesMarkerDecorations(editorInstance, markers)

    const releasePreview = (): void => {
      previewRelease?.()
      previewRelease = null
    }

    const refreshMarkers = (): void => {
      const position = editorInstance.getPosition()
      markers = position
        ? nesLocationMarkers(nesPlanStore.editsForPath(filePath), position).sort(
            (left, right) => left.lineNumber - right.lineNumber
          )
        : []
      collection.set(nesMarkerDecorations(markers))
    }

    const editAtCursor = (): NesEdit | null => {
      const model = editorInstance.getModel()
      const position = editorInstance.getPosition()
      if (!model || !position) {
        return null
      }
      return nesPlanStore.editAt(model.uri.toString(), position)
    }

    const decide = (): NesTabDecision => {
      const model = editorInstance.getModel()
      const edit = editAtCursor()
      // Why: the provider owns the rules of what it can draw, so it decides whether a suggestion shows.
      const hasInlineSuggestion =
        model !== null && edit !== null && nesInlineCompletionForEdit(edit, model) !== null
      return decideNesTabAction({ hasInlineSuggestion, hasOtherLocations: markers.length > 0 })
    }

    const accept = (): void => {
      const model = editorInstance.getModel()
      const edit = editAtCursor()
      if (!model || !edit) {
        return
      }
      // Why: Monaco's ghost text must not outlive the text we applied.
      void editorInstance.getAction('editor.action.inlineSuggest.hide')?.run()
      applyNesEdit(model, editorInstance, edit)
    }

    const jump = (): void => {
      const position = editorInstance.getPosition()
      const next = position ? nextMarkerAfter(markers, position) : null
      if (!next) {
        return
      }
      // Why: the edit's range end is where the edit becomes the anchor, so the ghost text shows there.
      editorInstance.setPosition({
        lineNumber: next.edit.range.endLine,
        column: next.edit.range.endColumn
      })
    }

    const preview = (active: boolean): void => {
      if (!active) {
        releasePreview()
        return
      }
      const model = editorInstance.getModel()
      const edit = editAtCursor()
      if (!model || !edit) {
        return
      }
      // Why: a fresh press replaces the widget an earlier one left behind.
      releasePreview()
      previewRelease = previewNesEdit(model, editorInstance, edit)
    }

    const tick = async (): Promise<void> => {
      const model = editorInstance.getModel()
      const position = editorInstance.getPosition()
      if (!model || !position) {
        return
      }
      if (editorInstance.getOption(editor.EditorOption.readOnly)) {
        return
      }
      const generation = generationRef.current + 1
      generationRef.current = generation
      const context = buildNesContext(model, position, {
        filePath,
        relativePath: relativePath ?? filePath
      })
      const relatedFiles = files
        ? await collectNesRelatedFiles({
            filePath,
            fileText: model.getValue(),
            symbolAtCursor: identifierAtCursor(model, position),
            files
          })
        : []
      const plan = await requestNesPlan({
        ...context,
        languageId,
        relatedFiles,
        recentEdits: []
      })
      // Why: the user typed again while the request was in flight, so the answer is about older text.
      if (generationRef.current !== generation) {
        return
      }
      if (plan) {
        nesPlanStore.setPlan(filePath, plan)
      }
      fireNesInlineCompletionsChanged()
      refreshMarkers()
    }

    const scheduleTick = (): void => {
      if (timer !== null) {
        clearTimeout(timer)
      }
      timer = setTimeout(() => {
        timer = null
        void tick()
      }, triggerDelayMs)
    }

    const contentSubscription = editorInstance.onDidChangeModelContent(scheduleTick)
    const cursorSubscription = editorInstance.onDidChangeCursorPosition(() => {
      // Why: the marker list drops the edit under the cursor, so it follows the cursor.
      refreshMarkers()
      scheduleTick()
    })

    // Why: the content sync lands before this effect subscribes, so opening a file would never ask.
    scheduleTick()

    handlersByEditor.set(editorInstance, { decide, accept, jump, preview })

    return () => {
      // Why: an answer that arrives after the editor moved on must not reach the store.
      generationRef.current += 1
      if (timer !== null) {
        clearTimeout(timer)
      }
      contentSubscription.dispose()
      cursorSubscription.dispose()
      releasePreview()
      collection.clear()
      handlersByEditor.delete(editorInstance)
    }
  }, [
    editorInstance,
    modelKey,
    filePath,
    relativePath,
    languageId,
    enabled,
    triggerDelayMs,
    enabledExtensions,
    files
  ])
}

/** The word under the cursor, which is the symbol the related-file search looks for. */
function identifierAtCursor(model: editor.ITextModel, position: IPosition): string | null {
  const word = model.getWordUntilPosition(position)
  return word.word.length > 0 ? word.word : null
}

function isExtensionEnabled(filePath: string, enabledExtensions: readonly string[]): boolean {
  const extension = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase()
  return enabledExtensions.some((entry) => entry.toLowerCase() === extension)
}

/** The location after the cursor; the list cycles, so the last one leads back to the first. */
function nextMarkerAfter(
  markers: readonly NesLocationMarker[],
  position: { lineNumber: number; column: number }
): NesLocationMarker | null {
  if (markers.length === 0) {
    return null
  }
  const after = markers.find((marker) => isAfterCursor(marker.edit, position))
  return after ?? markers[0]
}

function isAfterCursor(edit: NesEdit, position: { lineNumber: number; column: number }): boolean {
  if (edit.range.endLine !== position.lineNumber) {
    return edit.range.endLine > position.lineNumber
  }
  return edit.range.endColumn > position.column
}
