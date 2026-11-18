import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'
import { CODE_COMPLETION_CREDENTIAL_CHANNELS } from '../../shared/code-completion/code-completion-credential-channels'
import type { CodeCompletionCredentialsStatus } from '../../shared/code-completion/code-completion-credentials-status'

export const codeCompletionApi = {
  getStatus: (): Promise<CodeCompletionCredentialsStatus> =>
    ipcRenderer.invoke(CODE_COMPLETION_CREDENTIAL_CHANNELS.getCredentialStatus),
  saveApiKey: (key: string): Promise<CodeCompletionCredentialsStatus> =>
    ipcRenderer.invoke(CODE_COMPLETION_CREDENTIAL_CHANNELS.saveApiKey, key),
  clearApiKey: (): Promise<CodeCompletionCredentialsStatus> =>
    ipcRenderer.invoke(CODE_COMPLETION_CREDENTIAL_CHANNELS.clearApiKey)
} satisfies PreloadApi['codeCompletion']
