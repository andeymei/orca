import { z } from 'zod'
import type { NesRequest } from '../../shared/code-completion/code-completion-types'
import {
  emptyCompletionUsage,
  inlineCompletionPlan,
  nesBackendIdentity,
  planFromCompletionStream,
  type CompletionBackendOptions,
  type NesBackend,
  type NesBackendConfig,
  type NesBackendResult
} from './completion-backend'
import { completionEndpointUrl } from './completion-http'

const OPENAI_COMPLETIONS_PATH = '/completions'

const openAiCompletionText = z.object({
  choices: z.array(z.object({ text: z.string() })).min(1)
})

export function createOpenAiFimBackend(
  config: NesBackendConfig,
  options?: CompletionBackendOptions
): NesBackend {
  // Why: the endpoint continues the text it is given, so it answers with the text that belongs
  // after the prompt. A prompt that carried the file's tail would ask for the text that belongs
  // after that tail, and the answer would land in the wrong place.
  const inlineConfig: NesBackendConfig = { ...config, responseMode: 'inline' }
  return {
    id: 'openai-completions-fim',
    identity: nesBackendIdentity('openai-completions-fim', inlineConfig),
    planCapable: false,
    plan(input: NesRequest, signal: AbortSignal): Promise<NesBackendResult> {
      return planFromCompletionStream(
        {
          url: completionEndpointUrl(config.baseUrl, OPENAI_COMPLETIONS_PATH),
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            'content-type': 'application/json'
          },
          body: {
            model: config.model,
            max_tokens: config.maxTokens,
            prompt: input.prefix,
            stream: true
          },
          signal,
          fetchImpl: options?.fetchImpl
        },
        openAiCompletionStreamText,
        (text) => inlineCompletionPlan(text, input),
        () => emptyCompletionUsage()
      )
    }
  }
}

function openAiCompletionStreamText(events: readonly unknown[]): string {
  let text = ''
  for (const event of events) {
    const parsed = openAiCompletionText.safeParse(event)
    if (parsed.success) {
      text += parsed.data.choices[0].text
    }
  }
  return text
}
