import { z } from 'zod'
import { NES_CURSOR_MARKER } from '../../shared/code-completion/code-completion-prompt'
import {
  validateNesEditPlan,
  type NesEdit,
  type NesEditPlan,
  type NesRequest
} from '../../shared/code-completion/code-completion-types'
import {
  NES_COMPLETION_OUTPUT_LIMIT,
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
  return {
    id: 'openai-completions-fim',
    identity: nesBackendIdentity('openai-completions-fim', config),
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
            prompt: `${input.prefix}${NES_CURSOR_MARKER}${input.suffix}`,
            stream: true
          },
          signal,
          fetchImpl: options?.fetchImpl
        },
        openAiCompletionStreamText,
        (text) => fimCompletionPlan(text, input)
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

/** The completion lands at the cursor, whose position the request carries in absolute terms. */
function fimCursorEdit(text: string, input: NesRequest): NesEdit {
  return {
    id: 'fim-cursor',
    path: input.filePath,
    kind: 'insert',
    range: {
      startLine: input.cursorLine,
      startColumn: input.cursorColumn,
      endLine: input.cursorLine,
      endColumn: input.cursorColumn
    },
    originalText: '',
    text,
    label: 'Completion'
  }
}

function fimCompletionPlan(text: string, input: NesRequest): NesEditPlan {
  // The trailing break would insert a blank line; the leading whitespace is the model's own indentation.
  const completion = text.replace(/\r?\n+$/, '').slice(0, NES_COMPLETION_OUTPUT_LIMIT)
  return validateNesEditPlan(
    { edits: completion ? [fimCursorEdit(completion, input)] : [] },
    { allowedPaths: [input.filePath] }
  )
}
