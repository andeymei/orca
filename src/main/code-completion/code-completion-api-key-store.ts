import { createEncryptedApiKeyFileStore } from '../credentials/encrypted-api-key-file-store'

const store = createEncryptedApiKeyFileStore({
  fileName: 'code-completion-api-key.enc',
  envelopePrefix: 'orca-code-completion-api-key:v1:',
  providerLabel: 'Code completion',
  logScope: 'code-completion'
})

export const hasCodeCompletionApiKey = store.has
export const readCodeCompletionApiKey = store.read
export const saveCodeCompletionApiKey = store.save
export const clearCodeCompletionApiKey = store.clear
export const getCodeCompletionApiKeyProtection = store.protection
export const codeCompletionApiKeyEnvelopeFile = store.envelopeFile
