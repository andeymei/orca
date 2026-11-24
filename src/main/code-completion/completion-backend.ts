import {
  validateNesEditPlan,
  type NesBackendId,
  type NesEdit,
  type NesEditPlan,
  type NesRequest,
  type NesResponseMode
} from '../../shared/code-completion/code-completion-types'
import {
  buildNesInlineSystemPrompt,
  buildNesInlineUserPrompt,
  buildNesSystemPrompt,
  buildNesUserPrompt
} from '../../shared/code-completion/code-completion-prompt'
import { cleanInlineSuggestion, looksLikeToolMarkup } from './completion-inline-text'
import { planFromCompletionText } from './completion-plan-reading'
import {
  completionEndpointUrl,
  parseCompletionSseEvents,
  postCompletionJson,
  type CompletionHttpRequest
} from './completion-http'

export type CompletionUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

/**
 * Why an answer carries no plan: the endpoint failed, or what it said was not a plan.
 *
 * The difference matters to the user: "the model had nothing to propose" is an answer, and
 * "the answer never arrived in a usable shape" is a fault.
 */
export type NesPlanFailure = 'http_error' | 'unparsed'

export type NesBackendResult = {
  plan: NesEditPlan | null
  usage: CompletionUsage
  /** Set when the answer carries no plan, so the caller can say which it was. */
  failure?: NesPlanFailure
  /**
   * The endpoint reasoned before it answered, and the reasoning took the room the answer needed.
   *
   * Why: an endpoint whose model thinks first spends the budget on the thinking, and the empty
   * answer it leaves behind looks exactly like a model with nothing to propose.
   */
  reasoned?: boolean
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
  /** The shape the model answers with; it decides both the prompt and how the answer is read. */
  responseMode: NesResponseMode
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
 * Who answers a request: the protocol, the endpoint, the model, the auto-import switch and the
 * shape the answer has. Two backends with different identities answer differently, so an answer is
 * only good for the identity that produced it.
 */
export function nesBackendIdentity(protocol: NesBackendId, config: NesBackendConfig): string {
  return [
    protocol,
    completionEndpointUrl(config.baseUrl, ''),
    config.model,
    config.autoImport ? 'auto-import' : 'no-auto-import',
    config.responseMode
  ].join('|')
}

/**
 * The prompt a mode asks with.
 *
 * Why the mode decides the prompt: the two modes want different things from the model, and asking
 * a model for a plan while reading its answer as text (or the other way round) loses the answer.
 */
export function nesPromptPair(
  config: NesBackendConfig,
  input: NesRequest
): { system: string; user: string } {
  if (config.responseMode === 'inline') {
    return {
      system: buildNesInlineSystemPrompt(),
      user: buildNesInlineUserPrompt(input)
    }
  }
  return {
    system: buildNesSystemPrompt({ autoImport: config.autoImport }),
    user: buildNesUserPrompt({ ...input, autoImport: config.autoImport })
  }
}

/**
 * The plan an answer carries, read the way the mode asked for it.
 *
 * Why the inline mode needs no plan from the model: the answer is the text, so the edit is
 * written here — at the cursor, with nothing for the model to get wrong.
 */
export function nesPlanFromAnswer(
  config: NesBackendConfig,
  text: string,
  input: NesRequest
): NesEditPlan | null {
  if (config.responseMode === 'inline') {
    return inlineCompletionPlan(text, input)
  }
  return planFromCompletionText(text, input)
}

/**
 * The plan an inline answer carries: one insert at the cursor, holding the text to insert.
 *
 * Why the text is cleaned first: a model that repeats the code around the cursor, or wraps its
 * answer in a fence, would otherwise be shown as gray text that says what the file already says.
 */
export function inlineCompletionPlan(text: string, input: NesRequest): NesEditPlan {
  if (looksLikeToolMarkup(text)) {
    return { edits: [] }
  }
  const suggestion = cleanInlineSuggestion(text, { prefix: input.prefix, suffix: input.suffix })
  if (!suggestion) {
    return { edits: [] }
  }
  const edit: NesEdit = {
    id: 'inline-cursor',
    path: input.filePath,
    kind: 'insert',
    range: {
      startLine: input.cursorLine,
      startColumn: input.cursorColumn,
      endLine: input.cursorLine,
      endColumn: input.cursorColumn
    },
    originalText: '',
    text: suggestion,
    label: 'Completion'
  }
  return validateNesEditPlan({ edits: [edit] }, { allowedPaths: [input.filePath] })
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
    return { plan: null, usage: emptyCompletionUsage(), failure: 'http_error' }
  }
  const events = parseCompletionSseEvents(result.text)
  if (!events) {
    return { plan: null, usage: emptyCompletionUsage(), failure: 'unparsed' }
  }
  const plan = finish(extractText(events))
  return { plan, usage: usageOf(events), ...(plan ? {} : { failure: 'unparsed' }) }
}
