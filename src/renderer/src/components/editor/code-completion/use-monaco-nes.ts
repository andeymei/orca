import { useEffect, useState } from 'react'
import type { editor } from 'monaco-editor'
import { nesPlanStore } from './nes-plan-store'
import type { NesNextEdit } from './nes-next-edit'
import { startNesFeature } from './nes-editor-feature'

export { nesShortcutHandlersFor, type NesShortcutHandlers } from './nes-editor-feature'

/**
 * The trigger of the next-edit suggestion: it watches the editor, asks for a plan and keeps the
 * plan, the gutter markers and the shortcuts in step with it.
 */
export function useMonacoNextEditSuggestions(params: {
  filePath: string | undefined
  relativePath: string | undefined
  enabled: boolean
  triggerDelayMs: number
  /** The extensions the feature is on for; a file outside the list is skipped whole. */
  enabledExtensions: readonly string[]
  /** How much of the file before the cursor is sent. */
  contextPrefixChars: number
  /** How much of the file after the cursor is sent. */
  contextSuffixChars: number
  /** How long an answer may take before it is no longer shown; zero waits as long as it can. */
  displayDeadlineMs: number
  /** The model the endpoint answers with; the counters are kept per model. */
  completionModel: string
  /** The live editor — the hook needs its model, its cursor and its decoration collection. */
  editorInstance: editor.IStandaloneCodeEditor | null
}): {
  /** The edits that carry a gutter marker. */
  markerCount: number
  /** The edit the cursor cannot show, when the plan holds one the user should look at. */
  nextEdit: NesNextEdit | null
} {
  const {
    filePath,
    relativePath,
    enabled,
    triggerDelayMs,
    enabledExtensions,
    contextPrefixChars,
    contextSuffixChars,
    displayDeadlineMs,
    completionModel,
    editorInstance
  } = params
  // Why: the glyph margin is off by default, so the editor has to be told that a marker is in it.
  const [markerCount, setMarkerCount] = useState(0)
  // Why: the plan can hold an edit the cursor cannot show, and a marker alone reads as nothing
  // happened, so the notice names the place.
  const [nextEdit, setNextEdit] = useState<NesNextEdit | null>(null)
  // Why: the provider asks the store by the model's own URI, so the binding has to carry that key.
  const modelKey = editorInstance?.getModel()?.uri.toString() ?? null
  // Why: the list arrives as an array, so a fresh one would restart the feature every render.
  const extensionsKey = enabledExtensions.join(',')

  useEffect(() => {
    // Why: an unbound model finds no plan, so a plan left over from a switched-off feature cannot show.
    if (!modelKey || !filePath || !enabled) {
      return
    }
    if (!isExtensionEnabled(filePath, extensionsKey)) {
      return
    }
    nesPlanStore.bindModel(modelKey, filePath)
    return () => {
      nesPlanStore.unbindModel(modelKey)
    }
  }, [modelKey, filePath, enabled, extensionsKey])

  useEffect(() => {
    if (!editorInstance || !modelKey || !filePath || !enabled) {
      return
    }
    if (!isExtensionEnabled(filePath, extensionsKey)) {
      return
    }
    const feature = startNesFeature({
      editorInstance,
      modelKey,
      filePath,
      relativePath,
      triggerDelayMs,
      extensionsKey,
      contextPrefixChars,
      contextSuffixChars,
      displayDeadlineMs,
      completionModel,
      onMarkersChanged: setMarkerCount,
      onNextEditChanged: (next) => setNextEdit(next)
    })
    return () => {
      feature.dispose()
    }
  }, [
    editorInstance,
    modelKey,
    filePath,
    relativePath,
    enabled,
    triggerDelayMs,
    extensionsKey,
    contextPrefixChars,
    contextSuffixChars,
    displayDeadlineMs,
    completionModel
  ])

  return { markerCount, nextEdit }
}

function isExtensionEnabled(filePath: string, extensionsKey: string): boolean {
  const extension = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase()
  // Why: an empty list splits into one empty entry, and a file without an extension would match it.
  return extensionsKey.split(',').some((entry) => entry !== '' && entry.toLowerCase() === extension)
}
