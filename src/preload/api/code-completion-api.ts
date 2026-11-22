import type { CodeCompletionCredentialsStatus } from '../../shared/code-completion/code-completion-credentials-status'
import type { CodeCompletionSuggestionReport } from '../../shared/code-completion/code-completion-suggestion-outcome'

export type CodeCompletionApi = {
  getStatus: () => Promise<CodeCompletionCredentialsStatus>
  saveApiKey: (key: string) => Promise<CodeCompletionCredentialsStatus>
  clearApiKey: () => Promise<CodeCompletionCredentialsStatus>
  /** Tells the main process what became of a plan, so the trace can connect it to the screen. */
  reportSuggestionOutcome: (report: CodeCompletionSuggestionReport) => Promise<void>
}
