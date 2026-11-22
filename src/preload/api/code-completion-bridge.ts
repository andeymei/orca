import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'
import { CODE_COMPLETION_CREDENTIAL_CHANNELS } from '../../shared/code-completion/code-completion-credential-channels'
import type { CodeCompletionCredentialsStatus } from '../../shared/code-completion/code-completion-credentials-status'
import {
  CODE_COMPLETION_SUGGESTION_CHANNELS,
  type CodeCompletionSuggestionReport
} from '../../shared/code-completion/code-completion-suggestion-outcome'
import {
  CODE_COMPLETION_METRIC_CHANNELS,
  type CodeCompletionMetricReport
} from '../../shared/code-completion/code-completion-metrics'

export const codeCompletionApi = {
  getStatus: (): Promise<CodeCompletionCredentialsStatus> =>
    ipcRenderer.invoke(CODE_COMPLETION_CREDENTIAL_CHANNELS.getCredentialStatus),
  saveApiKey: (key: string): Promise<CodeCompletionCredentialsStatus> =>
    ipcRenderer.invoke(CODE_COMPLETION_CREDENTIAL_CHANNELS.saveApiKey, key),
  clearApiKey: (): Promise<CodeCompletionCredentialsStatus> =>
    ipcRenderer.invoke(CODE_COMPLETION_CREDENTIAL_CHANNELS.clearApiKey),
  reportSuggestionOutcome: (report: CodeCompletionSuggestionReport): Promise<void> =>
    ipcRenderer.invoke(CODE_COMPLETION_SUGGESTION_CHANNELS.reportSuggestionOutcome, report),
  recordMetric: (report: CodeCompletionMetricReport): Promise<void> =>
    ipcRenderer.invoke(CODE_COMPLETION_METRIC_CHANNELS.recordMetric, report)
} satisfies PreloadApi['codeCompletion']
