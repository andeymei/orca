import { ipcMain } from 'electron'
import {
  clearCodeCompletionApiKeyCredential,
  getCodeCompletionCredentialStatus,
  saveCodeCompletionApiKeyCredential
} from '../code-completion/code-completion-credential-commands'

export function registerCodeCompletionCredentialHandlers(): void {
  ipcMain.handle('codeCompletion:getCredentialStatus', () => getCodeCompletionCredentialStatus())
  ipcMain.handle('codeCompletion:saveApiKey', (_event, key: unknown) =>
    saveCodeCompletionApiKeyCredential(key)
  )
  ipcMain.handle('codeCompletion:clearApiKey', () => clearCodeCompletionApiKeyCredential())
}
