/** The IPC channel names both sides of the credential bridge use; one list so a rename cannot half-apply. */
export const CODE_COMPLETION_CREDENTIAL_CHANNELS = {
  getCredentialStatus: 'codeCompletion:getCredentialStatus',
  saveApiKey: 'codeCompletion:saveApiKey',
  clearApiKey: 'codeCompletion:clearApiKey'
} as const
