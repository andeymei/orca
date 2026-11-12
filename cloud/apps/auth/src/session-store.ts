import type { AuthDatabase } from './auth-database.js'
import { newIdentifier } from './auth-identity.js'
import { readNumber, readOptionalNumber, readOptionalString, readString } from './record-value.js'
import { deriveRefreshToken, parseRefreshToken, refreshTokenMacMatches } from './refresh-token.js'
import type { TokenSigner } from './token-signer.js'

export type SessionTokens = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  refreshExpiresAt: number
}

export type SessionGrant = {
  userId: string
  cloudProfileId: string
  tokens: SessionTokens
}

export type SessionIssuerInput = {
  audience: string
  accessTokenTtlMs: number
  refreshTokenTtlMs: number
  refreshRotationGraceMs: number
  refreshTokenKey: Uint8Array
  signer: TokenSigner
  now?: () => number
}

async function readActiveOrgId(
  database: AuthDatabase,
  cloudProfileId: string
): Promise<string | undefined> {
  const [row] = await database.query(
    'SELECT active_org_id FROM auth_cloud_profiles WHERE cloud_profile_id = ?',
    [cloudProfileId]
  )
  return row ? readOptionalString(row, 'active_org_id') : undefined
}

async function activeOrgOf(
  database: AuthDatabase,
  cloudProfileId: string
): Promise<{ orgId?: string }> {
  const orgId = await readActiveOrgId(database, cloudProfileId)
  return orgId === undefined ? {} : { orgId }
}

export async function createSession(
  database: AuthDatabase,
  input: SessionIssuerInput & { userId: string; cloudProfileId: string }
): Promise<SessionGrant> {
  const sessionId = newIdentifier('session')
  const now = input.now?.() ?? Date.now()
  const refreshExpiresAt = now + input.refreshTokenTtlMs
  const refreshToken = deriveRefreshToken(input.refreshTokenKey, sessionId, 1)
  await database.query(
    `INSERT INTO auth_sessions
       (session_id, user_id, cloud_profile_id, refresh_generation, refresh_expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [sessionId, input.userId, input.cloudProfileId, 1, refreshExpiresAt, now]
  )
  const accessToken = await input.signer.mintAccessToken({
    userId: input.userId,
    cloudProfileId: input.cloudProfileId,
    sessionId,
    ...(await activeOrgOf(database, input.cloudProfileId)),
    ttlMs: input.accessTokenTtlMs,
    audience: input.audience
  })
  return {
    userId: input.userId,
    cloudProfileId: input.cloudProfileId,
    tokens: {
      accessToken: accessToken.token,
      refreshToken,
      expiresAt: accessToken.expiresAt,
      refreshExpiresAt
    }
  }
}

/**
 * Rotates a refresh token. The desktop retries a refresh it never got an answer for, so the
 * superseded token stays usable for a grace window and yields the token the client already holds
 * rather than a new one that would invalidate what the client stored.
 */
export async function rotateSession(
  database: AuthDatabase,
  input: SessionIssuerInput & { refreshToken: string }
): Promise<SessionGrant | null> {
  const parts = parseRefreshToken(input.refreshToken)
  if (!parts || !refreshTokenMacMatches(input.refreshTokenKey, parts)) {
    return null
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const [row] = await database.query('SELECT * FROM auth_sessions WHERE session_id = ?', [
      parts.sessionId
    ])
    if (!row) {
      return null
    }
    const now = input.now?.() ?? Date.now()
    if (readOptionalNumber(row, 'revoked_at') !== undefined) {
      return null
    }
    if (readNumber(row, 'refresh_expires_at') <= now) {
      return null
    }
    const generation = readNumber(row, 'refresh_generation')
    const sessionId = readString(row, 'session_id')
    const userId = readString(row, 'user_id')
    const cloudProfileId = readString(row, 'cloud_profile_id')
    if (parts.generation === generation - 1) {
      // A replay of the superseded token: answer with the token the client already holds.
      const graceUntil = readOptionalNumber(row, 'previous_refresh_valid_until')
      if (graceUntil === undefined || graceUntil <= now) {
        return null
      }
      return await buildGrant(database, input, {
        userId,
        cloudProfileId,
        sessionId,
        refreshToken: deriveRefreshToken(input.refreshTokenKey, sessionId, generation),
        refreshExpiresAt: readNumber(row, 'refresh_expires_at')
      })
    }
    if (parts.generation !== generation) {
      return null
    }
    const nextGeneration = generation + 1
    const refreshExpiresAt = now + input.refreshTokenTtlMs
    const [result] = await database.query(
      `UPDATE auth_sessions
          SET refresh_generation = ?, previous_refresh_valid_until = ?, refresh_expires_at = ?
        WHERE session_id = ? AND refresh_generation = ?`,
      [
        nextGeneration,
        now + input.refreshRotationGraceMs,
        refreshExpiresAt,
        sessionId,
        generation
      ]
    )
    if (readNumber(result, 'changes') === 0) {
      // Another refresh rotated first; the loop re-reads and answers with the current token.
      continue
    }
    return await buildGrant(database, input, {
      userId,
      cloudProfileId,
      sessionId,
      refreshToken: deriveRefreshToken(input.refreshTokenKey, sessionId, nextGeneration),
      refreshExpiresAt
    })
  }
  return null
}

export async function revokeSession(database: AuthDatabase, refreshToken: string): Promise<boolean> {
  const parts = parseRefreshToken(refreshToken)
  if (!parts) {
    return false
  }
  return await revokeSessionById(database, parts.sessionId)
}

/** Ends the session an access token was minted for, so the token stops working at once. */
export async function revokeSessionById(
  database: AuthDatabase,
  sessionId: string
): Promise<boolean> {
  const [result] = await database.query(
    'UPDATE auth_sessions SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL',
    [Date.now(), sessionId]
  )
  return readNumber(result, 'changes') > 0
}

/** A revoked session must not keep its access token usable until the token expires. */
export async function isSessionActive(
  database: AuthDatabase,
  sessionId: string
): Promise<boolean> {
  const [row] = await database.query(
    'SELECT session_id FROM auth_sessions WHERE session_id = ? AND revoked_at IS NULL',
    [sessionId]
  )
  return row !== undefined
}

export async function sessionBelongsToUser(
  database: AuthDatabase,
  refreshToken: string,
  userId: string
): Promise<boolean> {
  const parts = parseRefreshToken(refreshToken)
  if (!parts) {
    return false
  }
  const [row] = await database.query(
    'SELECT user_id FROM auth_sessions WHERE session_id = ? AND revoked_at IS NULL',
    [parts.sessionId]
  )
  return row !== undefined && readString(row, 'user_id') === userId
}

async function buildGrant(
  database: AuthDatabase,
  input: SessionIssuerInput,
  identity: {
    userId: string
    cloudProfileId: string
    sessionId: string
    refreshToken: string
    refreshExpiresAt: number
  }
): Promise<SessionGrant> {
  const accessToken = await input.signer.mintAccessToken({
    userId: identity.userId,
    cloudProfileId: identity.cloudProfileId,
    sessionId: identity.sessionId,
    ...(await activeOrgOf(database, identity.cloudProfileId)),
    ttlMs: input.accessTokenTtlMs,
    audience: input.audience
  })
  return {
    userId: identity.userId,
    cloudProfileId: identity.cloudProfileId,
    tokens: {
      accessToken: accessToken.token,
      refreshToken: identity.refreshToken,
      expiresAt: accessToken.expiresAt,
      refreshExpiresAt: identity.refreshExpiresAt
    }
  }
}
