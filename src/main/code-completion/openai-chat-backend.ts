import { z } from 'zod'
import {
  buildNesSystemPrompt,
  buildNesUserPrompt
} from '../../shared/code-completion/code-completion-prompt'
import type { NesRequest } from '../../shared/code-completion/code-completion-types'
import {
  completionTokenCount,
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

const OPENAI_CHAT_PATH = '/chat/completions'

const openAiChatDelta = z.object({
  choices: z.array(z.object({ delta: z.object({ content: z.string() }) })).min(1)
})

const usageCounts = z.record(z.string(), z.unknown())

// Why a record: a null detail is legal, and one of them must not discard the others.
const openAiChatUsage = z.object({
  usage: usageCounts.nullable().optional()
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
            stream: true,
            stream_options: { include_usage: true }
          },
          signal,
          fetchImpl: options?.fetchImpl
        },
        openAiChatStreamText,
        (text) => planFromCompletionText(text, input),
        openAiChatStreamUsage
      )
    }
  }
}

/** The endpoint reports the totals once, on the final chunk, and only when the request asks. */
function openAiChatStreamUsage(events: readonly unknown[]): CompletionUsage {
  const usage = emptyCompletionUsage()
  for (const event of events) {
    const parsed = openAiChatUsage.safeParse(event)
    if (!parsed.success || !parsed.data.usage) {
      continue
    }
    const counts = parsed.data.usage
    const details = usageCounts.safeParse(counts.prompt_tokens_details)
    usage.inputTokens = completionTokenCount(counts.prompt_tokens) ?? usage.inputTokens
    usage.outputTokens = completionTokenCount(counts.completion_tokens) ?? usage.outputTokens
    usage.cacheReadTokens =
      completionTokenCount(details.success ? details.data.cached_tokens : null) ??
      usage.cacheReadTokens
  }
  return usage
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
