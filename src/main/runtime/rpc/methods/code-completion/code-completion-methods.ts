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

/** How many tokens a completion answer may take. */
const NES_COMPLETION_MAX_TOKENS = 2000

export const CODE_COMPLETION_METHODS = [
  defineMethod({
    name: 'codeCompletion.plan',
    permission: 'workspace',
    params: CodeCompletionPlan,
    handler: async (params, { runtime, signal }): Promise<CodeCompletionPlanResult> => {
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
        signal ?? new AbortController().signal
      )
      return { plan: result.plan }
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
