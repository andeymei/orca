import {
  clearCodeCompletionApiKey,
  codeCompletionApiKeyEnvelopeFile,
  getCodeCompletionApiKeyProtection,
  hasCodeCompletionApiKey,
  saveCodeCompletionApiKey
} from './code-completion-api-key-store'
import { savedCredentialUnreadable } from '../credentials/saved-credential-readability'
import type { CodeCompletionCredentialsStatus } from '../../shared/code-completion/code-completion-credentials-status'

export async function getCodeCompletionCredentialStatus(): Promise<CodeCompletionCredentialsStatus> {
  const configured = await hasCodeCompletionApiKey()
  return {
    configured,
    protection: configured ? await getCodeCompletionApiKeyProtection() : null,
    unreadable: configured
      ? await savedCredentialUnreadable(codeCompletionApiKeyEnvelopeFile())
      : undefined
  }
}

export async function saveCodeCompletionApiKeyCredential(
  key: unknown
): Promise<CodeCompletionCredentialsStatus> {
  // IPC values remain untrusted despite the declared type.
  if (typeof key !== 'string') {
    throw new Error('Code completion API key must be a string')
  }
  const trimmed = key.trim()
  // The key becomes an Authorization header value, so an interior newline cannot be sent.
  if (/[\r\n]/.test(trimmed)) {
    throw new Error('Code completion API key must be a single line')
  }
  await saveCodeCompletionApiKey(trimmed)
  return getCodeCompletionCredentialStatus()
}

export async function clearCodeCompletionApiKeyCredential(): Promise<CodeCompletionCredentialsStatus> {
  await clearCodeCompletionApiKey()
  return getCodeCompletionCredentialStatus()
}
