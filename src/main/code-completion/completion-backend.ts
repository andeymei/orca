import {
  NES_IMPORT_LABEL_PREFIX,
  validateNesEditPlan,
  type NesBackendId,
  type NesEdit,
  type NesEditPlan,
  type NesRequest
} from '../../shared/code-completion/code-completion-types'
import { NES_CURSOR_MARKER } from '../../shared/code-completion/code-completion-prompt'
import {
  completionEndpointUrl,
  parseCompletionSseEvents,
  postCompletionJson,
  type CompletionHttpRequest
} from './completion-http'

/** The spec caps a completion answer; a longer one is dropped as a parse failure. */
export const NES_COMPLETION_OUTPUT_LIMIT = 8000

export type CompletionUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

export type NesBackendResult = {
  plan: NesEditPlan | null
  usage: CompletionUsage
}

export type NesBackend = {
  readonly id: NesBackendId
  /** Who answers: the protocol, the endpoint, the model and the auto-import switch. */
  readonly identity: string
  readonly planCapable: boolean
  plan(input: NesRequest, signal: AbortSignal): Promise<NesBackendResult>
}

export type NesBackendConfig = {
  baseUrl: string
  model: string
  apiKey: string
  maxTokens: number
  autoImport: boolean
}

export type CompletionBackendOptions = {
  fetchImpl?: typeof fetch
}

export function emptyCompletionUsage(): CompletionUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
}

/** A provider's token count, or null when the field is absent or not a count. */
export function completionTokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/** The absolute paths a plan may name: the edited file and the related files. */
export function nesAllowedPaths(input: NesRequest): string[] {
  return [input.filePath, ...input.relatedFiles.map((relatedFile) => relatedFile.path)]
}

/**
 * Who answers a request: the protocol, the endpoint, the model and the auto-import switch.
 * Two backends with different identities answer differently, so an answer is only good for
 * the identity that produced it.
 */
export function nesBackendIdentity(protocol: NesBackendId, config: NesBackendConfig): string {
  return [
    protocol,
    completionEndpointUrl(config.baseUrl, ''),
    config.model,
    config.autoImport ? 'auto-import' : 'no-auto-import'
  ].join('|')
}

/** The file line the shown text of a path starts at; the model counts from it. */
export function nesStartLineFor(request: NesRequest, path: string): number {
  const relatedFile = request.relatedFiles.find((candidate) => candidate.path === path)
  return relatedFile ? relatedFile.startLine : request.prefixStartLine
}

/** The plan with absolute line numbers; the model's line numbers count from what it saw. */
export function translateNesEditLines(plan: NesEditPlan, request: NesRequest): NesEditPlan {
  const cursorLine = request.cursorLine - request.prefixStartLine + 1
  return {
    edits: plan.edits.map((edit) => {
      // Why: an import belongs at the top of its own file — the rule is per file, not per current file.
      if (isNesImportEdit(edit)) {
        return {
          ...edit,
          // The import lands on line 1, so it must not join the file's first line.
          text: edit.text.endsWith('\n') ? edit.text : `${edit.text}\n`,
          range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }
        }
      }
      const offset = nesStartLineFor(request, edit.path) - 1
      const currentFile = edit.path === request.filePath
      return {
        ...edit,
        range: {
          ...edit.range,
          startLine: edit.range.startLine + offset,
          endLine: edit.range.endLine + offset,
          startColumn:
            currentFile && edit.range.startLine === cursorLine
              ? nesColumnWithoutCursorMarker(edit.range.startColumn, request)
              : edit.range.startColumn,
          endColumn:
            currentFile && edit.range.endLine === cursorLine
              ? nesColumnWithoutCursorMarker(edit.range.endColumn, request)
              : edit.range.endColumn
        }
      }
    })
  }
}

// Why: the model counts the cursor marker as text, so every column after it is too far right.
function nesColumnWithoutCursorMarker(column: number, request: NesRequest): number {
  if (column < request.cursorColumn + NES_CURSOR_MARKER.length) {
    return column
  }
  return column - NES_CURSOR_MARKER.length
}

/**
 * The range an edit really covers, found from the text the model quoted.
 *
 * A small model counts the lines of a long file badly, but it quotes the text it wants to change
 * accurately. The text decides where the edit lands; the line the model named is only used when
 * the text cannot be found. A model that echoed the cursor marker into the text it quoted means
 * "the text up to the cursor", and that part is what the edit covers.
 */
export function repairNesEditRanges(plan: NesEditPlan, request: NesRequest): NesEditPlan {
  return {
    edits: plan.edits.map((edit) => {
      const covered = nesTextBeforeMarker(edit.originalText)
      const text = nesTextWithoutMarker(edit.text)
      const shown = nesShownContent(request, edit.path)
      const located =
        covered.length > 0 && shown
          ? locateNesText(shown.content, covered, shown.cursorOffset)
          : null
      if (!located || !shown) {
        return { ...edit, originalText: covered, text }
      }
      return {
        ...edit,
        originalText: covered,
        text,
        range: {
          startLine: shown.startLine + located.startLine - 1,
          startColumn: located.startColumn,
          endLine: shown.startLine + located.endLine - 1,
          endColumn: located.endColumn
        }
      }
    })
  }
}

/** The text the model was shown for a path, and the file line that text starts at. */
function nesShownContent(
  request: NesRequest,
  path: string
): { content: string; startLine: number; cursorOffset: number } | null {
  if (path === request.filePath) {
    return {
      content: request.prefix + request.suffix,
      startLine: request.prefixStartLine,
      cursorOffset: request.prefix.length
    }
  }
  const related = request.relatedFiles.find((file) => file.path === path)
  return related
    ? { content: related.content, startLine: related.startLine, cursorOffset: 0 }
    : null
}

/** The text the model quoted up to the cursor; the marker itself is not part of the file. */
function nesTextBeforeMarker(text: string): string {
  const marker = text.indexOf(NES_CURSOR_MARKER)
  return marker === -1 ? text : text.slice(0, marker)
}

/** The text the model quoted without the marker, which is not part of the file. */
function nesTextWithoutMarker(text: string): string {
  return text.split(NES_CURSOR_MARKER).join('')
}

/**
 * Where the quoted text sits in the file, as the range it covers.
 *
 * The occurrence nearest the cursor wins, because the same line can appear twice and the edit
 * belongs where the developer is typing.
 */
function locateNesText(
  content: string,
  needle: string,
  cursorOffset: number
): { startLine: number; startColumn: number; endLine: number; endColumn: number } | null {
  const first = content.indexOf(needle)
  if (first === -1) {
    return null
  }
  let best = first
  let bestDistance = Math.abs(first - cursorOffset)
  for (
    let index = content.indexOf(needle, first + 1);
    index !== -1;
    index = content.indexOf(needle, index + 1)
  ) {
    const distance = Math.abs(index - cursorOffset)
    if (distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  }
  const start = nesPositionInContent(content, best)
  const end = nesPositionInContent(content, best + needle.length)
  return {
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column
  }
}

/** The line and column an offset sits at, counted from the first line of the content. */
function nesPositionInContent(content: string, offset: number): { line: number; column: number } {
  let line = 1
  let lineStart = 0
  for (let index = 0; index < offset; index += 1) {
    if (content[index] === '\n') {
      line += 1
      lineStart = index + 1
    }
  }
  return { line, column: offset - lineStart + 1 }
}

/** The edit that adds an import; its label carries the marker the prompt asked for. */
function isNesImportEdit(edit: NesEdit): boolean {
  return edit.kind === 'insert' && edit.label.startsWith(NES_IMPORT_LABEL_PREFIX)
}

/** The plan a model answer carries, in the file's own line numbers. */
export function planFromCompletionText(text: string, input: NesRequest): NesEditPlan | null {
  const parsed = parseNesPlanJson(text)
  if (!parsed) {
    return null
  }
  // Why: the model counts the lines of a long file badly and quotes the text it wants to change
  // accurately, so the quoted text decides where the edit lands. The shape of the edit and the
  // rules it has to obey are checked on the repaired edit, not on the model's guess.
  return validateNesEditPlan(parsed, {
    allowedPaths: nesAllowedPaths(input),
    repair: (plan) => repairNesEditRanges(translateNesEditLines(plan, input), input)
  })
}

/** The plan a model answer carries, or null when the answer is not JSON. */
export function parseNesPlanText(
  text: string,
  allowedPaths: readonly string[]
): NesEditPlan | null {
  const parsed = parseNesPlanJson(text)
  return parsed ? validateNesEditPlan(parsed, { allowedPaths }) : null
}

/** The answer of a model, as JSON; null when it is not JSON at all. */
function parseNesPlanJson(text: string): unknown {
  try {
    return JSON.parse(text.slice(0, NES_COMPLETION_OUTPUT_LIMIT))
  } catch {
    return null
  }
}

/** The plan a completion stream carries; the finishing step and the usage fields differ per protocol. */
export async function planFromCompletionStream(
  request: CompletionHttpRequest,
  extractText: (events: readonly unknown[]) => string,
  finish: (text: string) => NesEditPlan | null,
  usageOf: (events: readonly unknown[]) => CompletionUsage
): Promise<NesBackendResult> {
  const result = await postCompletionJson(request)
  if (!result.ok) {
    return { plan: null, usage: emptyCompletionUsage() }
  }
  const events = parseCompletionSseEvents(result.text)
  if (!events) {
    return { plan: null, usage: emptyCompletionUsage() }
  }
  return { plan: finish(extractText(events)), usage: usageOf(events) }
}
