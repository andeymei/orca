import {
  NES_IMPORT_LABEL_PREFIX,
  validateNesEditPlan,
  type NesBackendId,
  type NesEdit,
  type NesEditPlan,
  type NesRequest
} from '../../shared/code-completion/code-completion-types'
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
  return {
    edits: plan.edits.map((edit) => {
      // Why: an import belongs at the top of the file, not at the top of the window the model saw.
      if (isNesImportEdit(edit)) {
        return {
          ...edit,
          range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }
        }
      }
      const offset = nesStartLineFor(request, edit.path) - 1
      return {
        ...edit,
        range: {
          ...edit.range,
          startLine: edit.range.startLine + offset,
          endLine: edit.range.endLine + offset
        }
      }
    })
  }
}

/** The edit that adds an import; its label carries the marker the prompt asked for. */
function isNesImportEdit(edit: NesEdit): boolean {
  return edit.kind === 'insert' && edit.label.startsWith(NES_IMPORT_LABEL_PREFIX)
}

/** The plan a model answer carries, in the file's own line numbers. */
export function planFromCompletionText(text: string, input: NesRequest): NesEditPlan | null {
  const plan = parseNesPlanText(text, nesAllowedPaths(input))
  return plan ? translateNesEditLines(plan, input) : null
}

/** The plan a model answer carries, or null when the answer is not JSON. */
export function parseNesPlanText(
  text: string,
  allowedPaths: readonly string[]
): NesEditPlan | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(0, NES_COMPLETION_OUTPUT_LIMIT))
  } catch {
    return null
  }
  return validateNesEditPlan(parsed, { allowedPaths })
}

/** The plan a completion stream carries; the finishing step differs per protocol. */
export async function planFromCompletionStream(
  request: CompletionHttpRequest,
  extractText: (events: readonly unknown[]) => string,
  finish: (text: string) => NesEditPlan | null
): Promise<NesBackendResult> {
  const result = await postCompletionJson(request)
  if (!result.ok) {
    return { plan: null, usage: emptyCompletionUsage() }
  }
  const events = parseCompletionSseEvents(result.text)
  if (!events) {
    return { plan: null, usage: emptyCompletionUsage() }
  }
  return { plan: finish(extractText(events)), usage: emptyCompletionUsage() }
}
