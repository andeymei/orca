import { z } from 'zod'
import { salvagingArray } from '../zod-salvage'

export const NES_MAX_EDITS = 5
export const NES_MAX_EDITS_PER_FILE = 2

/** The label an import edit carries; the backend puts such an edit on the file's first line. */
export const NES_IMPORT_LABEL_PREFIX = 'import: '

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

/**
 * The shape a model answers with, brought back to what the editor can draw.
 *
 * A model that numbers its edits, or calls an insert an "import", means the same thing as one
 * that names them and calls it an insert; the intent is unambiguous, so the answer is read
 * instead of dropped. Only the text the range covers says which kind an edit is.
 */
function normalizeNesEdit(raw: unknown): unknown {
  if (!z.util.isPlainObject(raw)) {
    return raw
  }
  const edit: Record<string, unknown> = { ...raw }
  if (typeof edit.id === 'number') {
    edit.id = String(edit.id)
  }
  if (typeof edit.kind === 'string') {
    if (edit.originalText === '') {
      // Why: the model answers the same empty-range edit as an insert or as a replace from one
      // answer to the next, and the label decided whether the user saw the edit at all. An edit
      // that covers no text puts text there, so the text says which kind the edit is.
      edit.kind = 'insert'
    } else if (!NES_EDIT_KINDS.includes(edit.kind)) {
      edit.kind = 'replace'
    }
  }
  return edit
}

const NES_EDIT_KINDS: readonly string[] = NesEditKind.options

function normalizeNesEditPlan(raw: unknown): unknown {
  if (!z.util.isPlainObject(raw)) {
    return raw
  }
  const edits = raw.edits
  if (!Array.isArray(edits)) {
    return raw
  }
  return { ...raw, edits: edits.map(normalizeNesEdit) }
}

// Why: one broken edit drops itself, so the edits the model got right still reach the user.
export const NesEditPlan = z.object({
  edits: salvagingArray(NesEdit).check(z.maxLength(NES_MAX_EDITS))
})

export type NesEditKind = z.infer<typeof NesEditKind>
export type NesEditRange = z.infer<typeof NesEditRange>
export type NesEdit = z.infer<typeof NesEdit>
export type NesEditPlan = z.infer<typeof NesEditPlan>

/** The protocols a completion backend can speak; the id type is derived from this list. */
export const NES_BACKEND_IDS = [
  'anthropic-messages',
  'openai-chat',
  'openai-completions-fim'
] as const

export type NesBackendId = (typeof NES_BACKEND_IDS)[number]

/**
 * The shape the model answers with.
 *
 * `inline` asks for the text to insert at the cursor and for nothing else, so the model never
 * counts a line or names a range — the two things it is worst at. `plan` asks for a plan of
 * edits, which can propose a change anywhere in the file, but hands the model the counting too.
 */
export const NES_RESPONSE_MODES = ['inline', 'plan'] as const

export type NesResponseMode = (typeof NES_RESPONSE_MODES)[number]

/** An inline answer is a short snippet, so it needs a few tokens and not a plan's worth. */
export const NES_INLINE_MAX_TOKENS = 96

/** A plan names up to five edits with their ranges, so it needs room to write them out. */
export const NES_PLAN_MAX_TOKENS = 8000

export type NesRequest = {
  filePath: string
  relativePath: string
  languageId: string
  prefix: string
  suffix: string
  /** The file line the shown prefix starts at; 1 when the whole file precedes the cursor. */
  prefixStartLine: number
  /** The cursor's absolute position in the file. */
  cursorLine: number
  cursorColumn: number
  /** Each related file carries the file line its shown content starts at. */
  relatedFiles: readonly { path: string; content: string; startLine: number }[]
  recentEdits: readonly { path: string; label: string }[]
}

export type NesPromptInput = NesRequest & { autoImport: boolean }

export function validateNesEditPlan(
  raw: unknown,
  options: {
    allowedPaths: readonly string[]
    /** Fix the edits before the rules are checked, so a repair cannot smuggle in an undrawable edit. */
    repair?: (plan: NesEditPlan) => NesEditPlan
  }
): NesEditPlan {
  const parsed = NesEditPlan.safeParse(normalizeNesEditPlan(capNesEditCount(raw)))
  if (!parsed.success) {
    return { edits: [] }
  }
  const repaired = options.repair ? options.repair(parsed.data) : parsed.data
  const allowedPaths = new Set(options.allowedPaths)
  const kept: NesEdit[] = []
  const keptPerPath = new Map<string, number>()
  for (const edit of repaired.edits) {
    if (!isApplicableNesEdit(edit, allowedPaths)) {
      continue
    }
    const keptCount = keptPerPath.get(edit.path) ?? 0
    if (keptCount >= NES_MAX_EDITS_PER_FILE) {
      continue
    }
    keptPerPath.set(edit.path, keptCount + 1)
    kept.push(edit)
  }
  return { edits: kept }
}

function isApplicableNesEdit(edit: NesEdit, allowedPaths: ReadonlySet<string>): boolean {
  if (!allowedPaths.has(edit.path)) {
    return false
  }
  // Why: the editor draws an edit as an inline suggestion, so a range that spans lines can never
  // be shown; the text it carries may rewrite what the range covers.
  if (edit.range.startLine !== edit.range.endLine) {
    return false
  }
  // Why: an edit whose text is what its range already holds changes nothing, so there is nothing
  // to show and nothing for the user to accept.
  if (edit.text === edit.originalText) {
    return false
  }
  if (edit.kind === 'insert') {
    return edit.originalText === ''
  }
  // Why: the validator already drops the edits the editor cannot draw, and a delete is one of
  // them, so this branch is unreachable today; the kind stays in the schema for a later version.
  if (edit.kind === 'delete') {
    return edit.text === ''
  }
  return edit.originalText !== '' && edit.text !== ''
}

/**
 * True when the edit only appends to the text its range covers, so it can be offered inline.
 * The provider, the marker rule and the Tab routing all ask this, and they must agree.
 */
export function nesEditExtendsCoveredText(edit: NesEdit): boolean {
  return edit.text.length > edit.originalText.length && edit.text.startsWith(edit.originalText)
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
  // Why: a column below one would slice from the end of the line and answer with the wrong text.
  if (range.startColumn < 1 || range.endColumn < 1) {
    return null
  }
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
