import { z } from 'zod'
import {
  buildNesSystemPrompt,
  buildNesUserPrompt
} from '../../shared/code-completion/code-completion-prompt'
import type { NesRequest } from '../../shared/code-completion/code-completion-types'
import {
  nesBackendIdentity,
  planFromCompletionStream,
  planFromCompletionText,
  type CompletionBackendOptions,
  type NesBackend,
  type NesBackendConfig,
  type NesBackendResult
} from './completion-backend'
import { completionEndpointUrl } from './completion-http'

const OPENAI_CHAT_PATH = '/chat/completions'

const openAiChatDelta = z.object({
  choices: z.array(z.object({ delta: z.object({ content: z.string() }) })).min(1)
})

export function createOpenAiChatBackend(
  config: NesBackendConfig,
  options?: CompletionBackendOptions
): NesBackend {
  return {
    id: 'openai-chat',
    identity: nesBackendIdentity('openai-chat', config),
    planCapable: true,
    plan(input: NesRequest, signal: AbortSignal): Promise<NesBackendResult> {
      return planFromCompletionStream(
        {
          url: completionEndpointUrl(config.baseUrl, OPENAI_CHAT_PATH),
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            'content-type': 'application/json'
          },
          body: {
            model: config.model,
            max_tokens: config.maxTokens,
            messages: [
              { role: 'system', content: buildNesSystemPrompt({ autoImport: config.autoImport }) },
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
        openAiChatStreamText,
        (text) => planFromCompletionText(text, input)
      )
    }
  }
}

function openAiChatStreamText(events: readonly unknown[]): string {
  let text = ''
  for (const event of events) {
    const parsed = openAiChatDelta.safeParse(event)
    if (parsed.success) {
      text += parsed.data.choices[0].delta.content
    }
  }
  return text
}
