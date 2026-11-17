import {
  clearCodeCompletionApiKey,
  getCodeCompletionApiKeyProtection,
  hasCodeCompletionApiKey,
  saveCodeCompletionApiKey
} from './code-completion-api-key-store'
import type { CodeCompletionCredentialsStatus } from '../../shared/code-completion/code-completion-credentials-status'

export function getCodeCompletionCredentialStatus(): CodeCompletionCredentialsStatus {
  const configured = hasCodeCompletionApiKey()
  return {
    configured,
    protection: configured ? getCodeCompletionApiKeyProtection() : null
  }
}

export function saveCodeCompletionApiKeyCredential(key: unknown): CodeCompletionCredentialsStatus {
  // IPC values remain untrusted despite the declared type.
  if (typeof key !== 'string') {
    throw new Error('Code completion API key must be a string')
  }
  // The key becomes an Authorization header value, so an interior newline cannot be sent.
  if (/[\r\n]/.test(key)) {
    throw new Error('Code completion API key must be a single line')
  }
  saveCodeCompletionApiKey(key)
  return getCodeCompletionCredentialStatus()
}

export function clearCodeCompletionApiKeyCredential(): CodeCompletionCredentialsStatus {
  clearCodeCompletionApiKey()
  return getCodeCompletionCredentialStatus()
}
