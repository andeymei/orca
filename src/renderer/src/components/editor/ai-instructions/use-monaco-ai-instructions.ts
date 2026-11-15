import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import type { editor } from 'monaco-editor'
import type { AiInstruction, AiInstructionStatus } from '../../../../../shared/ai-instruction-types'
import { useAppStore } from '@/store'
import { aiInstructionFileKey } from '@/store/slices/ai-instructions/ai-instruction-entries'
import type { WorkspaceResource } from '@/lib/workspace/ownership/workspace-copy-owner'
import { useAiInstructionComments } from '../../diff-comments/use-diff-comment-owner'
import { mayHaveUnscannedAiInstruction, scanAiInstructions } from './ai-instruction-scan'
import { resolveAiInstructionStatuses } from './ai-instruction-status'

/** One `@ai` instruction, as the gutter shows it. */
export type AiInstructionGlyph = {
  lineNumber: number
  status: AiInstructionStatus
  instruction: string
  /** The record this instruction is matched to, when there is one. Task 10's "mark as done" needs it. */
  recordId?: string
}

/** The clicked instruction plus the click point, so the caller can anchor a popover to it. */
export type AiInstructionGlyphClick = {
  lineNumber: number
  point: { x: number; y: number }
}

const GLYPH_CLASS_NAMES = {
  pending: 'ai-instruction-glyph--pending',
  dispatched: 'ai-instruction-glyph--dispatched',
  completed: 'ai-instruction-glyph--completed'
} as const satisfies Record<AiInstructionStatus, string>

// Why these delays: Monaco loads a language's grammar lazily, so the first scan can tokenize the
// whole file to nothing. The grammar lands within a second, so the rescan ladder ends there.
const RESCAN_DELAYS_MS = [0, 50, 150, 400, 1000] as const

const NO_INSTRUCTIONS: readonly AiInstruction[] = []

/** True when two scans found the same instructions, so an unchanged file keeps its array identity. */
function sameInstructions(
  left: readonly AiInstruction[],
  right: readonly AiInstruction[]
): boolean {
  return (
    left.length === right.length &&
    left.every((instruction, index) => {
      const other = right[index]
      return (
        other !== undefined &&
        instruction.lineNumber === other.lineNumber &&
        instruction.instruction === other.instruction &&
        instruction.commentText === other.commentText &&
        instruction.contextExcerpt === other.contextExcerpt &&
        instruction.contextStartLine === other.contextStartLine &&
        instruction.contextEndLine === other.contextEndLine
      )
    })
  )
}

/**
 * The `@ai` instructions of the open file: their gutter glyphs, the click that opens the popover,
 * and the resolved entries published for the rest of the app.
 */
export function useMonacoAiInstructions(params: {
  mountedEditor: editor.IStandaloneCodeEditor | null
  model: editor.ITextModel | null
  relativePath: string
  worktreeId: string | undefined
  noteSource: WorkspaceResource
  enabled: boolean
}): {
  glyphs: AiInstructionGlyph[]
  /** Records the click the editor reported; the caller renders its popover from `glyphClick`. */
  onGlyphClick: (lineNumber: number, point: { x: number; y: number }) => void
  glyphClick: AiInstructionGlyphClick | null
} {
  const { mountedEditor, model, relativePath, worktreeId, noteSource, enabled } = params

  const [scan, setScan] = useState<{
    model: editor.ITextModel | null
    instructions: readonly AiInstruction[]
  }>({ model: null, instructions: NO_INSTRUCTIONS })
  // Why: a scan result belongs to the model it came from, so another file never shows the old one.
  const instructions = enabled && scan.model === model ? scan.instructions : NO_INSTRUCTIONS

  useEffect(() => {
    if (!model || !enabled) {
      return
    }
    let disposed = false
    let rescanTimer: ReturnType<typeof setTimeout> | null = null
    let rescanIndex = 0

    const scanNow = (): void => {
      if (disposed) {
        return
      }
      const found = scanAiInstructions(model)
      setScan((previous) =>
        previous.model === model && sameInstructions(previous.instructions, found)
          ? previous
          : { model, instructions: found }
      )
      if (
        mayHaveUnscannedAiInstruction(model.getValue(), found) &&
        rescanIndex < RESCAN_DELAYS_MS.length
      ) {
        const delay = RESCAN_DELAYS_MS[rescanIndex]
        rescanIndex += 1
        rescanTimer = setTimeout(() => {
          scanNow()
        }, delay)
      }
    }

    // Why: a change restarts the ladder, so a late grammar still gets its own bounded rescan.
    const rescan = (): void => {
      rescanIndex = 0
      scanNow()
    }

    const contentSubscription = model.onDidChangeContent(rescan)
    const languageSubscription = model.onDidChangeLanguage(rescan)
    rescanTimer = setTimeout(() => {
      scanNow()
    }, 0)

    return () => {
      disposed = true
      if (rescanTimer !== null) {
        clearTimeout(rescanTimer)
      }
      contentSubscription.dispose()
      languageSubscription.dispose()
    }
  }, [enabled, model])

  const { comments: aiRecords } = useAiInstructionComments(worktreeId, noteSource)
  const records = useMemo(
    () => (aiRecords ?? []).filter((record) => record.filePath === relativePath),
    [aiRecords, relativePath]
  )
  const resolved = useMemo(
    () => resolveAiInstructionStatuses(instructions, records),
    [instructions, records]
  )
  const glyphs = useMemo(
    () =>
      resolved.map((entry) => ({
        lineNumber: entry.lineNumber,
        status: entry.status,
        instruction: entry.instruction,
        recordId: entry.recordId
      })),
    [resolved]
  )

  const publishAiInstructionEntries = useAppStore((s) => s.publishAiInstructionEntries)
  const fileKey = worktreeId ? aiInstructionFileKey(worktreeId, relativePath) : null
  // Why: a read-only mirror of the same file shares the key, so only the surface that published
  // entries may clear them.
  const publishedRef = useRef(false)

  useEffect(() => {
    if (!fileKey) {
      return
    }
    if (!enabled) {
      if (publishedRef.current) {
        publishedRef.current = false
        publishAiInstructionEntries(fileKey, null)
      }
      return
    }
    publishedRef.current = true
    publishAiInstructionEntries(fileKey, resolved)
  }, [enabled, fileKey, publishAiInstructionEntries, resolved])

  useEffect(() => {
    if (!fileKey) {
      return
    }
    return () => {
      if (publishedRef.current) {
        publishedRef.current = false
        publishAiInstructionEntries(fileKey, null)
      }
    }
  }, [fileKey, publishAiInstructionEntries])

  const decorationsRef = useRef<{
    editor: editor.IStandaloneCodeEditor
    collection: editor.IEditorDecorationsCollection
  } | null>(null)
  const decorations = useMemo(
    () =>
      glyphs.map((glyph) => ({
        range: new monaco.Range(glyph.lineNumber, 1, glyph.lineNumber, 1),
        options: {
          glyphMarginClassName: GLYPH_CLASS_NAMES[glyph.status],
          glyphMarginHoverMessage: { value: glyph.instruction },
          isWholeLine: false
        }
      })),
    [glyphs]
  )

  useEffect(() => {
    if (!mountedEditor) {
      return
    }
    if (decorationsRef.current?.editor !== mountedEditor) {
      decorationsRef.current = {
        editor: mountedEditor,
        collection: mountedEditor.createDecorationsCollection()
      }
    }
    decorationsRef.current.collection.set(enabled ? decorations : [])
  }, [decorations, enabled, mountedEditor])

  useEffect(() => {
    return () => {
      decorationsRef.current?.collection.clear()
      decorationsRef.current = null
    }
  }, [])

  const [clickState, setClickState] = useState<
    (AiInstructionGlyphClick & { fileKey: string }) | null
  >(null)
  const onGlyphClick = useCallback(
    (lineNumber: number, point: { x: number; y: number }) => {
      if (!fileKey) {
        return
      }
      setClickState({ fileKey, lineNumber, point })
    },
    [fileKey]
  )
  const glyphClick = useMemo<AiInstructionGlyphClick | null>(
    () =>
      clickState?.fileKey === fileKey
        ? { lineNumber: clickState.lineNumber, point: clickState.point }
        : null,
    [clickState, fileKey]
  )

  useEffect(() => {
    if (!mountedEditor || !enabled) {
      return
    }
    const subscription = mountedEditor.onMouseDown((event) => {
      if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
        return
      }
      const lineNumber = event.target.position?.lineNumber
      if (!lineNumber) {
        return
      }
      onGlyphClick(lineNumber, { x: event.event.posx, y: event.event.posy })
    })
    return () => {
      subscription.dispose()
    }
  }, [enabled, mountedEditor, onGlyphClick])

  return { glyphs, onGlyphClick, glyphClick }
}
