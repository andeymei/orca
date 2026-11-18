import {
  clearCodeCompletionApiKey,
  codeCompletionApiKeyEnvelopeFile,
  getCodeCompletionApiKeyProtection,
  hasCodeCompletionApiKey,
  saveCodeCompletionApiKey
} from './code-completion-api-key-store'
import { savedCredentialUnreadable } from '../credentials/saved-credential-readability'
import type { CodeCompletionCredentialsStatus } from '../../shared/code-completion/code-completion-credentials-status'

export function getCodeCompletionCredentialStatus(): CodeCompletionCredentialsStatus {
  const configured = hasCodeCompletionApiKey()
  return {
    configured,
    protection: configured ? getCodeCompletionApiKeyProtection() : null,
    unreadable: configured
      ? savedCredentialUnreadable(codeCompletionApiKeyEnvelopeFile())
      : undefined
  }
}

export function saveCodeCompletionApiKeyCredential(key: unknown): CodeCompletionCredentialsStatus {
  // IPC values remain untrusted despite the declared type.
  if (typeof key !== 'string') {
    throw new Error('Code completion API key must be a string')
  }
  const trimmed = key.trim()
  // The key becomes an Authorization header value, so an interior newline cannot be sent.
  if (/[\r\n]/.test(trimmed)) {
    throw new Error('Code completion API key must be a single line')
  }
  saveCodeCompletionApiKey(trimmed)
  return getCodeCompletionCredentialStatus()
}

export function clearCodeCompletionApiKeyCredential(): CodeCompletionCredentialsStatus {
  clearCodeCompletionApiKey()
  return getCodeCompletionCredentialStatus()
}
