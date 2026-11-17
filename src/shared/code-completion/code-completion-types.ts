import { z } from 'zod'

export const NES_MAX_EDITS = 5

export const NesEditKind = z.enum(['insert', 'replace', 'delete'])

export const NesEditRange = z.object({
  startLine: z.number().int().positive(),
  startColumn: z.number().int().positive(),
  endLine: z.number().int().positive(),
  endColumn: z.number().int().positive()
})

export const NesEdit = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  kind: NesEditKind,
  range: NesEditRange,
  originalText: z.string(),
  text: z.string(),
  label: z.string()
})

const NesUnvalidatedPlan = z.object({ edits: z.array(z.unknown()) })

// Why: the plan caps its edit count, so a longer answer keeps its first edits instead of failing whole.
function capNesEditCount(raw: unknown): unknown {
  const unvalidated = NesUnvalidatedPlan.safeParse(raw)
  if (!unvalidated.success || unvalidated.data.edits.length <= NES_MAX_EDITS) {
    return raw
  }
  return { edits: unvalidated.data.edits.slice(0, NES_MAX_EDITS) }
}

export const NesEditPlan = z.object({ edits: z.array(NesEdit).max(NES_MAX_EDITS) })

export type NesEditKind = z.infer<typeof NesEditKind>
export type NesEditRange = z.infer<typeof NesEditRange>
export type NesEdit = z.infer<typeof NesEdit>
export type NesEditPlan = z.infer<typeof NesEditPlan>

export type NesBackendId = 'anthropic-messages' | 'openai-chat' | 'openai-completions-fim'

export type NesRequest = {
  filePath: string
  relativePath: string
  languageId: string
  prefix: string
  suffix: string
  relatedFiles: readonly { path: string; content: string }[]
  recentEdits: readonly { path: string; label: string }[]
}

export type NesPromptInput = NesRequest & { autoImport: boolean }

export function validateNesEditPlan(
  raw: unknown,
  options: { allowedPaths: readonly string[] }
): NesEditPlan {
  const parsed = NesEditPlan.safeParse(capNesEditCount(raw))
  if (!parsed.success) {
    return { edits: [] }
  }
  const allowedPaths = new Set(options.allowedPaths)
  return {
    edits: parsed.data.edits.filter((edit) => isApplicableNesEdit(edit, allowedPaths))
  }
}

function isApplicableNesEdit(edit: NesEdit, allowedPaths: ReadonlySet<string>): boolean {
  if (!allowedPaths.has(edit.path)) {
    return false
  }
  if (edit.kind === 'insert') {
    return edit.originalText === ''
  }
  if (edit.kind === 'delete') {
    return edit.text === ''
  }
  return edit.originalText !== '' && edit.text !== ''
}

/** The text a 1-based range covers, with the end column exclusive; null when the range leaves the text. */
export function sliceRange(text: string, range: NesEditRange): string | null {
  const lines = text.split('\n')
  const startLineIndex = range.startLine - 1
  const endLineIndex = range.endLine - 1
  if (startLineIndex < 0 || endLineIndex < startLineIndex || endLineIndex >= lines.length) {
    return null
  }
  const startLineText = lines[startLineIndex]
  const endLineText = lines[endLineIndex]
  if (range.startColumn > startLineText.length + 1 || range.endColumn > endLineText.length + 1) {
    return null
  }
  if (startLineIndex === endLineIndex) {
    if (range.endColumn < range.startColumn) {
      return null
    }
    return startLineText.slice(range.startColumn - 1, range.endColumn - 1)
  }
  const middleLines = lines.slice(startLineIndex + 1, endLineIndex)
  return [
    startLineText.slice(range.startColumn - 1),
    ...middleLines,
    endLineText.slice(0, range.endColumn - 1)
  ].join('\n')
}
