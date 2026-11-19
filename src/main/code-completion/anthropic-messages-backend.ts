import { z } from 'zod'
import {
  buildNesSystemPrompt,
  buildNesUserPrompt
} from '../../shared/code-completion/code-completion-prompt'
import type { NesRequest } from '../../shared/code-completion/code-completion-types'
import {
  emptyCompletionUsage,
  nesBackendIdentity,
  planFromCompletionStream,
  planFromCompletionText,
  type CompletionBackendOptions,
  type CompletionUsage,
  type NesBackend,
  type NesBackendConfig,
  type NesBackendResult
} from './completion-backend'
import { completionEndpointUrl } from './completion-http'

const ANTHROPIC_MESSAGES_PATH = '/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

const anthropicTextDelta = z.object({
  type: z.literal('content_block_delta'),
  delta: z.object({ text: z.string() })
})

const anthropicMessageStart = z.object({
  type: z.literal('message_start'),
  message: z.object({
    usage: z.object({
      input_tokens: z.number(),
      cache_read_input_tokens: z.number().optional()
    })
  })
})

const anthropicMessageDelta = z.object({
  type: z.literal('message_delta'),
  usage: z.object({ output_tokens: z.number() })
})

export function createAnthropicMessagesBackend(
  config: NesBackendConfig,
  options?: CompletionBackendOptions
): NesBackend {
  return {
    id: 'anthropic-messages',
    identity: nesBackendIdentity('anthropic-messages', config),
    planCapable: true,
    plan(input: NesRequest, signal: AbortSignal): Promise<NesBackendResult> {
      return planFromCompletionStream(
        {
          url: completionEndpointUrl(config.baseUrl, ANTHROPIC_MESSAGES_PATH),
          headers: {
            'x-api-key': config.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'content-type': 'application/json'
          },
          body: {
            model: config.model,
            max_tokens: config.maxTokens,
            system: buildNesSystemPrompt({ autoImport: config.autoImport }),
            messages: [
              {
                role: 'user',
                content: buildNesUserPrompt({ ...input, autoImport: config.autoImport })
              }
            ],
            stream: true
          },
          signal,
          fetchImpl: options?.fetchImpl
        },
        anthropicStreamText,
        (text) => planFromCompletionText(text, input),
        anthropicStreamUsage
      )
    }
  }
}

/** The input counts arrive in `message_start`, the output count in the closing `message_delta`. */
function anthropicStreamUsage(events: readonly unknown[]): CompletionUsage {
  const usage = emptyCompletionUsage()
  for (const event of events) {
    const start = anthropicMessageStart.safeParse(event)
    if (start.success) {
      usage.inputTokens = start.data.message.usage.input_tokens
      usage.cacheReadTokens = start.data.message.usage.cache_read_input_tokens ?? 0
      continue
    }
    const delta = anthropicMessageDelta.safeParse(event)
    if (delta.success) {
      usage.outputTokens = delta.data.usage.output_tokens
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
