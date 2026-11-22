import { z } from 'zod'
import type { NesRequest } from '../../shared/code-completion/code-completion-types'
import {
  completionTokenCount,
  emptyCompletionUsage,
  nesBackendIdentity,
  nesPlanFromAnswer,
  nesPromptPair,
  type CompletionBackendOptions,
  type CompletionUsage,
  type NesBackend,
  type NesBackendConfig,
  type NesBackendResult
} from './completion-backend'
import {
  completionEndpointUrl,
  parseCompletionSseEvents,
  postCompletionJson
} from './completion-http'

const ANTHROPIC_MESSAGES_PATH = '/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

const anthropicTextDelta = z.object({
  type: z.literal('content_block_delta'),
  delta: z.object({ text: z.string() })
})

// Why a record: a null count is legal, and one of them must not discard the others.
const anthropicUsageEvent = z.object({
  type: z.string(),
  message: z.object({ usage: z.record(z.string(), z.unknown()) }).optional(),
  usage: z.record(z.string(), z.unknown()).optional()
})

/**
 * The endpoints that refuse the thinking control. A model that reasons first answers a suggestion
 * request slower and often answers nothing at all, so the request asks for no reasoning; an
 * endpoint that rejects the control outright is asked again without it, and is not asked again.
 */
const identitiesRefusingThinking = new Set<string>()

/** The statuses that mean the endpoint refused the request rather than failing on its own. */
const REFUSAL_STATUSES = new Set([400, 404, 405, 422])

export function createAnthropicMessagesBackend(
  config: NesBackendConfig,
  options?: CompletionBackendOptions
): NesBackend {
  const identity = nesBackendIdentity('anthropic-messages', config)
  return {
    id: 'anthropic-messages',
    identity,
    planCapable: true,
    async plan(input: NesRequest, signal: AbortSignal): Promise<NesBackendResult> {
      const prompts = nesPromptPair(config, input)
      const request = (withThinkingControl: boolean): Parameters<typeof postCompletionJson>[0] => ({
        url: completionEndpointUrl(config.baseUrl, ANTHROPIC_MESSAGES_PATH),
        headers: {
          'x-api-key': config.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json'
        },
        body: {
          model: config.model,
          max_tokens: config.maxTokens,
          system: prompts.system,
          messages: [
            {
              role: 'user',
              content: prompts.user
            }
          ],
          stream: true,
          // Why: a model that thinks first spends its budget deciding whether there is anything to
          // suggest, and then answers with nothing; the suggestion is the answer, not the thought.
          ...(withThinkingControl ? { thinking: { type: 'disabled' } } : {})
        },
        signal,
        fetchImpl: options?.fetchImpl
      })

      if (identitiesRefusingThinking.has(identity)) {
        return (await requestPlan(request(false), config, input)).result
      }
      const first = await requestPlan(request(true), config, input)
      if (first.ok || !first.refused) {
        return first.result
      }
      // Why: the endpoint refused the request, so the control is the likely reason; ask again
      // without it and stop asking for it from now on.
      identitiesRefusingThinking.add(identity)
      return (await requestPlan(request(false), config, input)).result
    }
  }
}

/** The plan the endpoint answered with, or the refusal that stopped the request. */
type PlanRequestResult =
  | { ok: true; result: NesBackendResult }
  | { ok: false; refused: boolean; result: NesBackendResult }

async function requestPlan(
  request: Parameters<typeof postCompletionJson>[0],
  config: NesBackendConfig,
  input: NesRequest
): Promise<PlanRequestResult> {
  const response = await postCompletionJson(request)
  if (!response.ok) {
    return {
      ok: false,
      refused: response.status !== undefined && REFUSAL_STATUSES.has(response.status),
      result: { plan: null, usage: emptyCompletionUsage(), failure: 'http_error' }
    }
  }
  const events = parseCompletionSseEvents(response.text)
  if (!events) {
    return {
      ok: false,
      refused: false,
      result: { plan: null, usage: emptyCompletionUsage(), failure: 'unparsed' }
    }
  }
  const plan = nesPlanFromAnswer(config, anthropicStreamText(events), input)
  return {
    ok: true,
    result: {
      plan,
      usage: anthropicStreamUsage(events),
      ...(plan ? {} : { failure: 'unparsed' })
    }
  }
}

/** The input counts arrive in `message_start`, the output count in the closing `message_delta`. */
function anthropicStreamUsage(events: readonly unknown[]): CompletionUsage {
  const usage = emptyCompletionUsage()
  for (const event of events) {
    const parsed = anthropicUsageEvent.safeParse(event)
    if (!parsed.success) {
      continue
    }
    if (parsed.data.type === 'message_start') {
      const counts = parsed.data.message?.usage
      usage.inputTokens = completionTokenCount(counts?.input_tokens) ?? usage.inputTokens
      usage.cacheReadTokens =
        completionTokenCount(counts?.cache_read_input_tokens) ?? usage.cacheReadTokens
    } else if (parsed.data.type === 'message_delta') {
      usage.outputTokens =
        completionTokenCount(parsed.data.usage?.output_tokens) ?? usage.outputTokens
      // Why: a gateway can report the input counts in the closing frame instead of the opening
      // one, and the usage the user reads must be the usage the endpoint reported.
      usage.inputTokens = completionTokenCount(parsed.data.usage?.input_tokens) ?? usage.inputTokens
      usage.cacheReadTokens =
        completionTokenCount(parsed.data.usage?.cache_read_input_tokens) ?? usage.cacheReadTokens
    }
  }
  return usage
}

function anthropicStreamText(events: readonly unknown[]): string {
  let text = ''
  for (const event of events) {
    const parsed = anthropicTextDelta.safeParse(event)
    if (parsed.success) {
      text += parsed.data.delta.text
    }
  }
  return text
}
