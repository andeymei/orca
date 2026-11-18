import { ipcMain } from 'electron'
import {
  clearCodeCompletionApiKeyCredential,
  getCodeCompletionCredentialStatus,
  saveCodeCompletionApiKeyCredential
} from '../code-completion/code-completion-credential-commands'
import { CODE_COMPLETION_CREDENTIAL_CHANNELS } from '../../shared/code-completion/code-completion-credential-channels'

export function registerCodeCompletionCredentialHandlers(): void {
  ipcMain.handle(CODE_COMPLETION_CREDENTIAL_CHANNELS.getCredentialStatus, () =>
    getCodeCompletionCredentialStatus()
  )
  ipcMain.handle(CODE_COMPLETION_CREDENTIAL_CHANNELS.saveApiKey, (_event, key: unknown) =>
    saveCodeCompletionApiKeyCredential(key)
  )
  ipcMain.handle(CODE_COMPLETION_CREDENTIAL_CHANNELS.clearApiKey, () =>
    clearCodeCompletionApiKeyCredential()
  )
}
