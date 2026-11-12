export type AuthorizationRequest = {
  clientId: string
  redirectUri: string
  scope: string
  nonce: string
  state: string
  codeChallenge: string
  codeChallengeMethod: 'S256'
  localProfileId?: string
}

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])
const base64Url43 = /^[A-Za-z0-9_-]{43}$/

/**
 * The desktop receives the code on a loopback listener it chose itself. Any other redirect
 * target would hand the authorization code to a third party.
 */
export function isLoopbackRedirectUri(value: string): boolean {
  try {
    const parsed = new URL(value)
    return (
      parsed.protocol === 'http:' &&
      loopbackHosts.has(parsed.hostname) &&
      parsed.pathname === '/auth/callback' &&
      parsed.search === '' &&
      parsed.hash === ''
    )
  } catch {
    return false
  }
}

export function parseAuthorizationRequest(
  query: Record<string, string | undefined>,
  expectedClientId: string
): AuthorizationRequest | null {
  const clientId = query['client_id']?.trim() ?? ''
  const redirectUri = query['redirect_uri']?.trim() ?? ''
  const state = query['state']?.trim() ?? ''
  const nonce = query['nonce']?.trim() ?? ''
  const codeChallenge = query['code_challenge']?.trim() ?? ''
  const codeChallengeMethod = query['code_challenge_method']?.trim() ?? ''
  const localProfileId = query['local_profile_id']?.trim() ?? ''

  if (clientId !== expectedClientId) {
    return null
  }
  if (query['response_type']?.trim() !== 'code') {
    return null
  }
  if (!isLoopbackRedirectUri(redirectUri)) {
    return null
  }
  if (!base64Url43.test(codeChallenge) || codeChallengeMethod !== 'S256') {
    return null
  }
  if (state.length === 0 || nonce.length === 0) {
    return null
  }
  return {
    clientId,
    redirectUri,
    scope: query['scope']?.trim() ?? '',
    nonce,
    state,
    codeChallenge,
    codeChallengeMethod: 'S256',
    ...(localProfileId.length > 0 ? { localProfileId } : {})
  }
}
