import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'
import type { CodeCompletionCredentialsStatus } from '../../shared/code-completion/code-completion-credentials-status'

export const codeCompletionApi = {
  getStatus: (): Promise<CodeCompletionCredentialsStatus> =>
    ipcRenderer.invoke('codeCompletion:getCredentialStatus'),
  saveApiKey: (key: string): Promise<CodeCompletionCredentialsStatus> =>
    ipcRenderer.invoke('codeCompletion:saveApiKey', key),
  clearApiKey: (): Promise<CodeCompletionCredentialsStatus> =>
    ipcRenderer.invoke('codeCompletion:clearApiKey')
} satisfies PreloadApi['codeCompletion']
