import { defineMethod } from '../../core'
import {
  CodeCompletionPlan,
  type CodeCompletionPlanResult
} from '../../../../../shared/rpc-contract/code-completion-params'
import type { NesBackendId } from '../../../../../shared/code-completion/code-completion-types'
import { createCompletionService } from '../../../../code-completion/completion-service'
import { createAnthropicMessagesBackend } from '../../../../code-completion/anthropic-messages-backend'
import { createOpenAiChatBackend } from '../../../../code-completion/openai-chat-backend'
import { createOpenAiFimBackend } from '../../../../code-completion/openai-fim-backend'
import { readCodeCompletionApiKey } from '../../../../code-completion/code-completion-api-key-store'
import type { NesBackend, NesBackendConfig } from '../../../../code-completion/completion-backend'
import { recordCompletionUsage } from '../../../../code-completion/completion-usage'

/**
 * How many tokens a completion answer may take. A reasoning model spends the first part of its
 * budget thinking, so a small cap leaves it no room to answer at all.
 */
const NES_COMPLETION_MAX_TOKENS = 8000

/**
 * The plan request each client has in flight for each file it is editing. A newer request for the
 * same file supersedes the older one: the user has typed since, so the older answer is about text
 * that is gone, and the endpoint should stop working on it. Two panes of one file share the key,
 * so the pane that asked last is the one that gets an answer.
 */
const inFlightPlanRequests = new Map<string, AbortController>()

function planRequestKey(clientId: string | undefined, filePath: string): string {
  return `${clientId ?? 'unknown-client'}:${filePath}`
}

export const CODE_COMPLETION_METHODS = [
  defineMethod({
    name: 'codeCompletion.plan',
    permission: 'workspace',
    params: CodeCompletionPlan,
    handler: async (params, { runtime, signal, clientId }): Promise<CodeCompletionPlanResult> => {
      // Why: the store holds the desktop's own settings; the client projection omits this block.
      const settings = runtime.requireStore().getSettings().codeCompletion
      if (!settings?.enabled) {
        return { plan: null }
      }
      // Why: a key file that cannot be read or decrypted must make the feature *inert*,
      // not broken. The credential status (Task 5) reports that state to the settings UI.
      let apiKey: string | null = null
      try {
        apiKey = readCodeCompletionApiKey()
      } catch {
        return { plan: null }
      }
      if (!apiKey || !settings.baseUrl || !settings.model) {
        return { plan: null }
      }
      const service = createCompletionService({
        resolveBackend: () =>
          createBackend(settings.protocol, {
            baseUrl: settings.baseUrl,
            model: settings.model,
            apiKey,
            maxTokens: NES_COMPLETION_MAX_TOKENS,
            autoImport: settings.autoImport
          })
      })
      const requestKey = planRequestKey(clientId, params.filePath)
      inFlightPlanRequests.get(requestKey)?.abort()
      const controller = new AbortController()
      inFlightPlanRequests.set(requestKey, controller)
      const abortFromCaller = (): void => controller.abort(signal?.reason)
      if (signal?.aborted) {
        controller.abort(signal.reason)
      } else {
        signal?.addEventListener('abort', abortFromCaller, { once: true })
      }
      try {
        const result = await service.plan(
          {
            filePath: params.filePath,
            relativePath: params.relativePath,
            languageId: params.languageId,
            prefix: params.prefix,
            suffix: params.suffix,
            prefixStartLine: params.prefixStartLine,
            cursorLine: params.cursorLine,
            cursorColumn: params.cursorColumn,
            relatedFiles: params.relatedFiles,
            recentEdits: params.recentEdits
          },
          controller.signal
        )
        const { usage } = result
        // Why: a null plan can still have spent tokens — the model answered, the answer was unusable.
        if (usage.inputTokens > 0 || usage.outputTokens > 0 || usage.cacheReadTokens > 0) {
          recordCompletionUsage({ model: settings.model, usage, at: Date.now() })
        }
        return { plan: result.plan }
      } finally {
        signal?.removeEventListener('abort', abortFromCaller)
        // Why: a superseded request must not retire the request that replaced it.
        if (inFlightPlanRequests.get(requestKey) === controller) {
          inFlightPlanRequests.delete(requestKey)
        }
      }
    }
  })
]

/** The backend that speaks the configured protocol; a fourth protocol must not compile silently. */
function createBackend(protocol: NesBackendId, config: NesBackendConfig): NesBackend {
  switch (protocol) {
    case 'anthropic-messages':
      return createAnthropicMessagesBackend(config)
    case 'openai-chat':
      return createOpenAiChatBackend(config)
    case 'openai-completions-fim':
      return createOpenAiFimBackend(config)
  }
}
