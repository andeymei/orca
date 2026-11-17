import { z } from 'zod'
import {
  buildNesSystemPrompt,
  buildNesUserPrompt
} from '../../shared/code-completion/code-completion-prompt'
import type { NesRequest } from '../../shared/code-completion/code-completion-types'
import {
  planFromCompletionStream,
  planFromCompletionText,
  type CompletionBackendOptions,
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

export function createAnthropicMessagesBackend(
  config: NesBackendConfig,
  options?: CompletionBackendOptions
): NesBackend {
  return {
    id: 'anthropic-messages',
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
        (text) => planFromCompletionText(text, input)
      )
    }
  }
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
