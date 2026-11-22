import { editor, KeyCode } from 'monaco-editor/esm/vs/editor/editor.api.js'
import { fireNesInlineCompletionsChanged, nesInlineCompletionForEdit } from './nes-inline-provider'
import { createNesEditorActions } from './nes-editor-actions'
import type { NesTabDecision } from './nes-key-routing'
import { refreshNesMarkers } from './nes-marker-refresh'
import { createNesMarkerDecorations, type NesLocationMarker } from './nes-location-markers'
import { createNesMetricTracker } from './nes-metric-tracker'
import { nesPlanStore } from './nes-plan-store'
import type { NesNextEdit } from './nes-next-edit'
import { requestNesPlanForEditor } from './nes-plan-request'
import { createNesRenameCarryOverWatcher } from './nes-rename-carry-over'
import { nesSuggestionOutcome, reportNesSuggestionOutcome } from './nes-suggestion-outcome'
import type { NesEdit } from '../../../../../shared/code-completion/code-completion-types'

/** What the editor's shortcut installers call; the feature publishes them for its own editor. */
export type NesShortcutHandlers = {
  decide: () => NesTabDecision
  accept: () => void
  /** Takes the next word of the suggestion, so a long answer is not all or nothing. */
  acceptWord: () => void
  /** Takes the next line of the suggestion. */
  acceptLine: () => void
  jump: () => void
  preview: (active: boolean) => void
  /** Whether the plan predicts a location the cursor is not on; the jump chord needs its own answer. */
  hasNextLocation: () => boolean
}

const handlersByEditor = new WeakMap<editor.IStandaloneCodeEditor, NesShortcutHandlers>()

/** The handlers of the editor that owns the feature, or null when the feature is off there. */
export function nesShortcutHandlersFor(
  editorInstance: editor.IStandaloneCodeEditor
): NesShortcutHandlers | null {
  return handlersByEditor.get(editorInstance) ?? null
}

export type NesFeatureParams = {
  editorInstance: editor.IStandaloneCodeEditor
  modelKey: string
  filePath: string
  relativePath: string | undefined
  triggerDelayMs: number
  /** The extensions the feature is on for, joined; a fresh array would restart the feature. */
  extensionsKey: string
  contextPrefixChars: number
  contextSuffixChars: number
  displayDeadlineMs: number
  completionModel: string
  /** The edit the cursor cannot show, when the plan holds one the user should look at. */
  onNextEditChanged: (
    next: NesNextEdit | null | ((previous: NesNextEdit | null) => NesNextEdit | null)
  ) => void
}

/**
 * The feature in the editor: it watches the editor, asks for a plan and keeps the plan, the
 * gutter markers and the shortcuts in step with it.
 */
export function startNesFeature(params: NesFeatureParams): { dispose: () => void } {
  const {
    editorInstance,
    modelKey,
    filePath,
    relativePath,
    triggerDelayMs,
    extensionsKey,
    contextPrefixChars,
    contextSuffixChars,
    displayDeadlineMs,
    completionModel
  } = params
  // Why: the request cannot be cancelled end to end, so a late answer is dropped by its number.
  let generation = 0
  // Why: the request that is on its way is about text the user has already replaced, so it is
  // stopped rather than left to finish and spend tokens on an answer nobody will read.
  let pendingRequest: AbortController | null = null
  if (!editorInstance || !modelKey || !filePath) {
    return { dispose: () => undefined }
  }
  if (!isExtensionEnabled(filePath, extensionsKey)) {
    return { dispose: () => undefined }
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  let previewRelease: (() => void) | null = null
  let markers: NesLocationMarker[] = []
  const collection = createNesMarkerDecorations(editorInstance, markers)

  const tracker = createNesMetricTracker({
    editorInstance,
    model: () => editorInstance.getModel(),
    modelName: () => completionModel,
    // Why: the suggestion is kept when it is still the one the editor would draw.
    isStillShown: () => {
      const model = editorInstance.getModel()
      const edit = editAtCursor()
      return Boolean(model && edit && nesInlineCompletionForEdit(edit, model) !== null)
    }
  })

  // Why: a rename is carried over without asking anybody, so the feature works with the
  // endpoint switched off.
  const renameWatcher = createNesRenameCarryOverWatcher({
    editorInstance,
    filePath,
    onCarryOver: (edits) => {
      nesPlanStore.setLocalPlan(filePath, { edits })
      fireNesInlineCompletionsChanged()
      refreshMarkers()
    }
  })

  const releasePreview = (): void => {
    previewRelease?.()
    previewRelease = null
  }

  const cancelScheduledTick = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const refreshMarkers = (): void => {
    markers = refreshNesMarkers({
      editorInstance,
      filePath,
      modelKey,
      collection,
      onNextEditChanged: params.onNextEditChanged
    })
  }

  const editAtCursor = (): NesEdit | null => {
    const model = editorInstance.getModel()
    const position = editorInstance.getPosition()
    if (!model || !position) {
      return null
    }
    return nesPlanStore.editAt(model.uri.toString(), position)
  }

  const dropPlan = (): void => {
    // Why: the plan must not outlive the user's decision, and an answer in flight predates it.
    generation += 1
    releasePreview()
    nesPlanStore.remove(filePath)
    fireNesInlineCompletionsChanged()
    refreshMarkers()
  }

  const actions = createNesEditorActions({
    editorInstance,
    editAtCursor,
    markers: () => markers,
    dropPlan,
    releasePreview,
    showPreview: (release) => {
      previewRelease = release
    },
    tracker
  })

  const tick = async (): Promise<void> => {
    const model = editorInstance.getModel()
    const position = editorInstance.getPosition()
    if (!model || !position) {
      return
    }
    if (editorInstance.getOption(editor.EditorOption.readOnly)) {
      return
    }
    const nextGeneration = generation + 1
    generation = nextGeneration
    pendingRequest?.abort()
    const controller = new AbortController()
    pendingRequest = controller
    const asked = await requestNesPlanForEditor({
      model,
      position,
      filePath,
      relativePath,
      contextPrefixChars,
      contextSuffixChars,
      displayDeadlineMs,
      signal: controller.signal
    })
    // Why: the user typed again while the request was in flight, so the answer is about older text.
    if (generation !== nextGeneration) {
      tracker.stale()
      return
    }
    if (asked.blocked) {
      // Why: the markers re-read the stored plan, so a request that was never made must not
      // leave the old one behind. The local suggestions stay: they came from the file.
      nesPlanStore.removeModelPlan(filePath)
      fireNesInlineCompletionsChanged()
      refreshMarkers()
      reportNesSuggestionOutcome({
        outcome: 'blocked',
        editCount: 0,
        file: relativePath ?? filePath
      })
      return
    }
    const plan = asked.plan
    if (plan) {
      nesPlanStore.setPlan(filePath, plan)
    } else {
      // Why: the markers re-read the stored plan, so a failed request must not leave the old
      // one. The local suggestions stay: they came from the file.
      nesPlanStore.removeModelPlan(filePath)
    }
    fireNesInlineCompletionsChanged()
    refreshMarkers()
    // Why: a request that failed is reported by the main process, which knows why it failed;
    // reporting it here as "the model had nothing to propose" would say the opposite.
    if (plan) {
      const { outcome, editCount } = nesSuggestionOutcome({
        plan,
        model,
        modelKey,
        position
      })
      reportNesSuggestionOutcome({ outcome, editCount, file: relativePath ?? filePath })
      if (outcome === 'shown') {
        tracker.shown(asked.latencyMs)
      }
    }
  }

  const scheduleTick = (): void => {
    cancelScheduledTick()
    timer = setTimeout(() => {
      timer = null
      void tick().catch((error: unknown) => {
        // Why: a message can carry the endpoint's path, so the log keeps the error's name only.
        console.error(
          '[code-completion] The plan tick failed.',
          error instanceof Error ? error.name : 'unknown'
        )
      })
    }, triggerDelayMs)
  }

  const contentSubscription = editorInstance.onDidChangeModelContent(scheduleTick)
  const cursorSubscription = editorInstance.onDidChangeCursorPosition(() => {
    // Why: the marker list drops the edit under the cursor, so it follows the cursor.
    refreshMarkers()
    // Why: a cursor move leaves the text alone, so the plan the request made still applies to
    // it. Asking again would cost a request per arrow key and cancel the answer in flight.
  })
  const keySubscription = editorInstance.onKeyDown((event) => {
    if (event.keyCode !== KeyCode.Escape) {
      return
    }
    // Why: an Esc that closes a widget, or lands with no suggestion showing, is not a rejection.
    if (actions.decide() !== 'accept-suggestion') {
      return
    }
    // Why: a tick still waiting would ask again for the same buffer and undo the rejection.
    cancelScheduledTick()
    dropPlan()
  })
  const mouseSubscription = editorInstance.onMouseDown((event) => {
    if (event.target.type !== editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
      return
    }
    // Why: a right click asks for a context menu, so only the left button jumps.
    if (!event.event.leftButton) {
      return
    }
    const lineNumber = event.target.position?.lineNumber
    if (!lineNumber) {
      return
    }
    const marker = markers.find((candidate) => candidate.lineNumber === lineNumber)
    if (marker) {
      actions.jump(marker)
    }
  })

  // Why: the content sync lands before this effect subscribes, so opening a file would never ask.
  scheduleTick()

  handlersByEditor.set(editorInstance, {
    decide: actions.decide,
    accept: actions.accept,
    acceptWord: actions.acceptWord,
    acceptLine: actions.acceptLine,
    jump: actions.jumpToNextLocation,
    preview: actions.preview,
    hasNextLocation: () => markers.length > 0
  })

  return {
    dispose: () => {
      // Why: an answer that arrives after the editor moved on must not reach the store.
      generation += 1
      pendingRequest?.abort()
      cancelScheduledTick()
      contentSubscription.dispose()
      cursorSubscription.dispose()
      keySubscription.dispose()
      mouseSubscription.dispose()
      releasePreview()
      tracker.dispose()
      renameWatcher.dispose()
      collection.clear()
      handlersByEditor.delete(editorInstance)
      params.onNextEditChanged(null)
    }
  }
}

function isExtensionEnabled(filePath: string, extensionsKey: string): boolean {
  const extension = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase()
  // Why: an empty list splits into one empty entry, and a file without an extension would match it.
  return extensionsKey.split(',').some((entry) => entry !== '' && entry.toLowerCase() === extension)
}
