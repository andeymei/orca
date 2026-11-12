import { describe, expect, it } from 'vitest'
import { openInMemoryAuthDatabase } from './auth-database.js'
import { createEphemeralSigningKey } from './signing-key.js'
import { createSession, rotateSession, type SessionIssuerInput } from './session-store.js'
import { createTokenSigner } from './token-signer.js'

const GRACE_MS = 60_000

async function createIssuer(now: () => number): Promise<SessionIssuerInput> {
  const signingKey = await createEphemeralSigningKey()
  return {
    audience: 'orca-desktop',
    accessTokenTtlMs: 15 * 60 * 1000,
    refreshTokenTtlMs: 30 * 24 * 60 * 60 * 1000,
    refreshRotationGraceMs: GRACE_MS,
    refreshTokenKey: new Uint8Array(32).fill(7),
    signer: createTokenSigner(signingKey, 'https://auth.example.com'),
    now
  }
}

describe('session refresh rotation', () => {
  it('answers a replayed refresh with the token the client already holds', async () => {
    let now = 1_700_000_000_000
    const issuer = await createIssuer(() => now)
    const database = await openInMemoryAuthDatabase()
    const session = await createSession(database, {
      ...issuer,
      userId: 'user_1',
      cloudProfileId: 'profile_1'
    })

    const rotated = await rotateSession(database, {
      ...issuer,
      refreshToken: session.tokens.refreshToken
    })
    expect(rotated).not.toBeNull()
    expect(rotated?.tokens.refreshToken).not.toBe(session.tokens.refreshToken)

    // The desktop retries a refresh it never got an answer for. The replay must not hand out a
    // second new token, because that would invalidate the one the client already stored.
    now += GRACE_MS / 2
    const replayed = await rotateSession(database, {
      ...issuer,
      refreshToken: session.tokens.refreshToken
    })
    expect(replayed).not.toBeNull()
    expect(replayed?.tokens.refreshToken).toBe(rotated?.tokens.refreshToken)

    // The token the client holds still works after the replay.
    const current = await rotateSession(database, {
      ...issuer,
      refreshToken: rotated?.tokens.refreshToken ?? ''
    })
    expect(current).not.toBeNull()
  })

  it('refuses a superseded refresh token once the grace window closed', async () => {
    let now = 1_700_000_000_000
    const issuer = await createIssuer(() => now)
    const database = await openInMemoryAuthDatabase()
    const session = await createSession(database, {
      ...issuer,
      userId: 'user_1',
      cloudProfileId: 'profile_1'
    })
    await rotateSession(database, { ...issuer, refreshToken: session.tokens.refreshToken })

    now += GRACE_MS * 2
    const expired = await rotateSession(database, {
      ...issuer,
      refreshToken: session.tokens.refreshToken
    })
    expect(expired).toBeNull()
  })

  it('refuses a refresh token that was never issued', async () => {
    const issuer = await createIssuer(() => 1_700_000_000_000)
    const database = await openInMemoryAuthDatabase()
    const result = await rotateSession(database, {
      ...issuer,
      refreshToken: 'not-a-real-token'
    })
    expect(result).toBeNull()
  })

  it('refuses a refresh token whose signature does not match the key', async () => {
    const issuer = await createIssuer(() => 1_700_000_000_000)
    const database = await openInMemoryAuthDatabase()
    const session = await createSession(database, {
      ...issuer,
      userId: 'user_1',
      cloudProfileId: 'profile_1'
    })
    const forged = `${session.tokens.refreshToken.split('.')[0]}.1.forged`
    const result = await rotateSession(database, { ...issuer, refreshToken: forged })
    expect(result).toBeNull()
  })
})
