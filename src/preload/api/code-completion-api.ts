import type { CodeCompletionCredentialsStatus } from '../../shared/code-completion/code-completion-credentials-status'

export type CodeCompletionCredentialsApi = {
  getStatus: () => Promise<CodeCompletionCredentialsStatus>
  saveApiKey: (key: string) => Promise<CodeCompletionCredentialsStatus>
  clearApiKey: () => Promise<CodeCompletionCredentialsStatus>
}
