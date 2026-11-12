import type { AuthDatabase } from './auth-database.js'
import { hashSecret, newSecret } from './auth-identity.js'
import { readNumber, readOptionalNumber, readOptionalString, readString } from './record-value.js'

export type AuthorizationCodeGrant = {
  clientId: string
  redirectUri: string
  codeChallenge: string
  nonce: string
  state: string
  userId: string
  localProfileId?: string
}

export type AuthorizationCodeExpectation = {
  clientId: string
  redirectUri: string
  state: string
  nonce: string
  codeChallenge: string
  localProfileId?: string
}

export async function issueAuthorizationCode(
  database: AuthDatabase,
  input: {
    userId: string
    clientId: string
    redirectUri: string
    codeChallenge: string
    nonce: string
    state: string
    localProfileId?: string
  },
  ttlMs: number
): Promise<string> {
  const code = newSecret()
  await database.query(
    `INSERT INTO auth_authorization_codes
       (code_hash, client_id, redirect_uri, code_challenge, nonce, state, local_profile_id, user_id, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      hashSecret(code),
      input.clientId,
      input.redirectUri,
      input.codeChallenge,
      input.nonce,
      input.state,
      input.localProfileId ?? null,
      input.userId,
      Date.now() + ttlMs
    ]
  )
  return code
}

/**
 * Consumes an authorization code only when the exchange matches what the code was issued for.
 * A mismatched attempt must not burn the code: the desktop retries a failed exchange.
 */
export async function consumeAuthorizationCode(
  database: AuthDatabase,
  code: string,
  expectation: AuthorizationCodeExpectation,
  now = Date.now()
): Promise<AuthorizationCodeGrant | null> {
  const codeHash = hashSecret(code)
  return await database.transaction(async (transaction) => {
    const [row] = await transaction.query(
      'SELECT * FROM auth_authorization_codes WHERE code_hash = ?',
      [codeHash]
    )
    if (!row) {
      return null
    }
    if (readOptionalNumber(row, 'consumed_at') !== undefined) {
      return null
    }
    if (readNumber(row, 'expires_at') <= now) {
      return null
    }
    const grant: AuthorizationCodeGrant = {
      clientId: readString(row, 'client_id'),
      redirectUri: readString(row, 'redirect_uri'),
      codeChallenge: readString(row, 'code_challenge'),
      nonce: readString(row, 'nonce'),
      state: readString(row, 'state'),
      userId: readString(row, 'user_id'),
      ...(readOptionalString(row, 'local_profile_id') === undefined
        ? {}
        : { localProfileId: readOptionalString(row, 'local_profile_id') })
    }
    if (!matchesExpectation(grant, expectation)) {
      return null
    }
    const [result] = await transaction.query(
      'UPDATE auth_authorization_codes SET consumed_at = ? WHERE code_hash = ? AND consumed_at IS NULL',
      [now, codeHash]
    )
    if (readNumber(result, 'changes') === 0) {
      return null
    }
    return grant
  })
}

function matchesExpectation(
  grant: AuthorizationCodeGrant,
  expectation: AuthorizationCodeExpectation
): boolean {
  if (grant.clientId !== expectation.clientId) {
    return false
  }
  if (grant.redirectUri !== expectation.redirectUri) {
    return false
  }
  if (grant.state !== expectation.state) {
    return false
  }
  if (grant.nonce !== expectation.nonce) {
    return false
  }
  if (grant.codeChallenge !== expectation.codeChallenge) {
    return false
  }
  if (
    expectation.localProfileId !== undefined &&
    grant.localProfileId !== undefined &&
    grant.localProfileId !== expectation.localProfileId
  ) {
    return false
  }
  return true
}

export async function purgeExpiredAuthorizationCodes(
  database: AuthDatabase,
  olderThan: number
): Promise<void> {
  await database.query('DELETE FROM auth_authorization_codes WHERE expires_at < ?', [olderThan])
}
