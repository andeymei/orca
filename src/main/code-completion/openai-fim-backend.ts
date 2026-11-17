import { z } from 'zod'
import { NES_CURSOR_MARKER } from '../../shared/code-completion/code-completion-prompt'
import {
  validateNesEditPlan,
  type NesEdit,
  type NesEditRange,
  type NesRequest
} from '../../shared/code-completion/code-completion-types'
import {
  emptyCompletionUsage,
  NES_COMPLETION_OUTPUT_LIMIT,
  type CompletionBackendOptions,
  type NesBackend,
  type NesBackendConfig,
  type NesBackendResult
} from './completion-backend'
import {
  completionEndpointUrl,
  parseCompletionSseEvents,
  postCompletionJson
} from './completion-http'

const OPENAI_COMPLETIONS_PATH = '/completions'

const openAiCompletionText = z.object({
  choices: z.array(z.object({ text: z.string() })).min(1)
})

export function createOpenAiFimBackend(
  config: NesBackendConfig,
  options?: CompletionBackendOptions
): NesBackend {
  return {
    id: 'openai-completions-fim',
    planCapable: false,
    async plan(input: NesRequest, signal: AbortSignal): Promise<NesBackendResult> {
      const result = await postCompletionJson({
        url: completionEndpointUrl(config.baseUrl, OPENAI_COMPLETIONS_PATH),
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json'
        },
        body: {
          model: config.model,
          max_tokens: config.maxTokens,
          prompt: `${input.prefix}${NES_CURSOR_MARKER}${input.suffix}`,
          stream: true
        },
        signal,
        fetchImpl: options?.fetchImpl
      })
      if (!result.ok) {
        return { plan: null, usage: emptyCompletionUsage() }
      }
      const events = parseCompletionSseEvents(result.text)
      if (!events) {
        return { plan: null, usage: emptyCompletionUsage() }
      }
      const completion = openAiCompletionStreamText(events).slice(0, NES_COMPLETION_OUTPUT_LIMIT)
      const plan = validateNesEditPlan(
        { edits: completion ? [fimCursorEdit(completion, input)] : [] },
        { allowedPaths: [input.filePath] }
      )
      return { plan, usage: emptyCompletionUsage() }
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

function fimCursorEdit(text: string, input: NesRequest): NesEdit {
  const range = cursorRange(input.prefix)
  return {
    id: 'fim-cursor',
    path: input.filePath,
    kind: 'insert',
    range,
    originalText: '',
    text,
    label: 'Completion'
  }
}

/** The cursor sits at the end of the prefix, so its position is the prefix's last line. */
function cursorRange(prefix: string): NesEditRange {
  const lines = prefix.split('\n')
  const line = lines.length
  const column = (lines.at(-1)?.length ?? 0) + 1
  return { startLine: line, startColumn: column, endLine: line, endColumn: column }
}
