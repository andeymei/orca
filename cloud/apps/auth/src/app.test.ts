import { createHash, randomBytes } from 'node:crypto'
import { createLocalJWKSet, jwtVerify } from 'jose'
import { describe, expect, it } from 'vitest'
import { createAuthApp } from './app.js'
import { openInMemoryAuthDatabase } from './auth-database.js'
import { createUser } from './auth-user.js'
import { deriveRelayHostId } from './auth-identity.js'
import { loadAuthConfig } from './config.js'
import { hashPassword } from './password-hash.js'
import { createEphemeralSigningKey } from './signing-key.js'
import { createTokenSigner } from './token-signer.js'

const OPERATOR_EMAIL = 'operator@example.com'
const OPERATOR_PASSWORD = 'correct horse battery staple'
const REDIRECT_URI = 'http://127.0.0.1:51234/auth/callback'
const CODE_VERIFIER = randomBytes(32).toString('base64url')
const CODE_CHALLENGE = createHash('sha256').update(CODE_VERIFIER).digest('base64url')

async function createHarness() {
  const config = loadAuthConfig({
    ORCA_AUTH_PUBLIC_URL: 'https://auth.example.com',
    ORCA_AUTH_BOOTSTRAP_USER_EMAIL: OPERATOR_EMAIL
  } as NodeJS.ProcessEnv)
  const database = await openInMemoryAuthDatabase()
  await createUser(database, {
    email: OPERATOR_EMAIL,
    passwordHash: await hashPassword(OPERATOR_PASSWORD)
  })
  const signingKey = await createEphemeralSigningKey()
  const signer = createTokenSigner(signingKey, config.issuer)
  const app = createAuthApp({
    config,
    database,
    signer,
    signingKey,
    sessionSecret: 'test-session-secret-that-is-long-enough'
  })
  return { app, config, database, signingKey }
}

function authorizeUrl(overrides: Record<string, string> = {}): string {
  const query = new URLSearchParams({
    client_id: 'orca-desktop',
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: 'openid profile email offline_access',
    nonce: 'nonce-value',
    state: 'state-value',
    code_challenge: CODE_CHALLENGE,
    code_challenge_method: 'S256',
    local_profile_id: 'local-default',
    ...overrides
  })
  return `https://auth.example.com/v1/desktop/auth/authorize?${query.toString()}`
}

async function signIn(
  app: Awaited<ReturnType<typeof createHarness>>['app']
): Promise<{ code: string; state: string }> {
  const response = await app.request(authorizeUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: 'orca-desktop',
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      scope: 'openid profile email offline_access',
      nonce: 'nonce-value',
      state: 'state-value',
      code_challenge: CODE_CHALLENGE,
      code_challenge_method: 'S256',
      local_profile_id: 'local-default',
      email: OPERATOR_EMAIL,
      password: OPERATOR_PASSWORD
    }).toString()
  })
  expect(response.status).toBe(302)
  const location = new URL(response.headers.get('location') ?? '')
  const code = location.searchParams.get('code') ?? ''
  const state = location.searchParams.get('state') ?? ''
  return { code, state }
}

async function signInWithPassword(
  app: Awaited<ReturnType<typeof createHarness>>['app'],
  password: string
): Promise<Response> {
  return await app.request(authorizeUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: 'orca-desktop',
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      scope: 'openid profile email offline_access',
      nonce: 'nonce-value',
      state: 'state-value',
      code_challenge: CODE_CHALLENGE,
      code_challenge_method: 'S256',
      local_profile_id: 'local-default',
      email: OPERATOR_EMAIL,
      password
    }).toString()
  })
}

describe('Orca Cloud auth service', () => {
  it('exchanges an authorization code for a session that carries the relay entitlement', async () => {
    const { app } = await createHarness()
    const { code, state } = await signIn(app)

    const response = await app.request('https://auth.example.com/v1/desktop/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        codeVerifier: CODE_VERIFIER,
        nonce: 'nonce-value',
        redirectUri: REDIRECT_URI,
        state,
        localProfileId: 'local-default'
      })
    })

    expect(response.status).toBe(200)
    const session = (await response.json()) as {
      accessToken: string
      refreshToken: string
      expiresAt: number
      cloud: { email: string; userId: string; cloudProfileId: string }
      capabilities: { flags: Record<string, boolean> }
    }
    expect(session.accessToken.length).toBeGreaterThan(0)
    expect(session.refreshToken.length).toBeGreaterThan(0)
    expect(session.expiresAt).toBeGreaterThan(Date.now())
    expect(session.cloud.email).toBe(OPERATOR_EMAIL)
    expect(session.cloud.userId.length).toBeGreaterThan(0)
    expect(session.capabilities.flags['relay.use']).toBe(true)
  })

  it('refuses an authorization code exchanged with the wrong PKCE verifier', async () => {
    const { app } = await createHarness()
    const { code, state } = await signIn(app)

    const response = await app.request('https://auth.example.com/v1/desktop/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        codeVerifier: randomBytes(32).toString('base64url'),
        nonce: 'nonce-value',
        redirectUri: REDIRECT_URI,
        state,
        localProfileId: 'local-default'
      })
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_grant' })
  })

  it('refuses an authorization request whose redirect target is not a loopback listener', async () => {
    const { app } = await createHarness()
    const response = await app.request(
      authorizeUrl({ redirect_uri: 'https://attacker.example.com/callback' })
    )
    expect(response.status).toBe(400)
  })

  it('mints a relay token the relay can verify, and refuses a host id that does not match the key', async () => {
    const { app, signingKey, config } = await createHarness()
    const { code, state } = await signIn(app)
    const exchange = await app.request('https://auth.example.com/v1/desktop/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        codeVerifier: CODE_VERIFIER,
        nonce: 'nonce-value',
        redirectUri: REDIRECT_URI,
        state,
        localProfileId: 'local-default'
      })
    })
    expect(exchange.status).toBe(200)
    const session = (await exchange.json()) as {
      accessToken: string
      cloud: { cloudProfileId: string }
    }

    const hostPublicKey = randomBytes(32)
    const hostPublicKeyB64 = Buffer.from(hostPublicKey).toString('base64')
    const relayHostId = deriveRelayHostId(hostPublicKey)

    const mismatched = await app.request('https://auth.example.com/v1/desktop/auth/relay-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session.accessToken}` },
      body: JSON.stringify({ relayHostId: 'AAAAAAAAAAAAAAAA', hostPublicKeyB64 })
    })
    expect(mismatched.status).toBe(400)
    expect(await mismatched.json()).toEqual({ error: 'relay_host_id_mismatch' })

    const response = await app.request('https://auth.example.com/v1/desktop/auth/relay-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session.accessToken}` },
      body: JSON.stringify({ relayHostId, hostPublicKeyB64 })
    })
    expect(response.status).toBe(200)
    const minted = (await response.json()) as { relayToken: string; expiresAt: number }
    expect(minted.expiresAt).toBeGreaterThan(Date.now())

    const jwks = createLocalJWKSet({ keys: [signingKey.publicJwk] })
    const verified = await jwtVerify(minted.relayToken, jwks, {
      issuer: config.issuer,
      audience: 'orca-relay',
      algorithms: ['ES256']
    })
    expect(verified.payload.purpose).toBe('host-control')
    expect(verified.payload.relayHostId).toBe(relayHostId)
    expect(verified.payload.prof).toBe(session.cloud.cloudProfileId)
    expect(typeof verified.payload.sub).toBe('string')
  })

  it('rejects a relay token request without a signed-in session', async () => {
    const { app } = await createHarness()
    const response = await app.request('https://auth.example.com/v1/desktop/auth/relay-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ relayHostId: 'AAAAAAAAAAAAAAAA', hostPublicKeyB64: 'AAAA' })
    })
    expect(response.status).toBe(401)
  })

  it('ends the session on sign-out, so the access token stops working at once', async () => {
    const { app } = await createHarness()
    const { code, state } = await signIn(app)
    const exchange = await app.request('https://auth.example.com/v1/desktop/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        codeVerifier: CODE_VERIFIER,
        nonce: 'nonce-value',
        redirectUri: REDIRECT_URI,
        state,
        localProfileId: 'local-default'
      })
    })
    expect(exchange.status).toBe(200)
    const session = (await exchange.json()) as {
      accessToken: string
      refreshToken: string
    }

    const logout = await app.request('https://auth.example.com/v1/desktop/auth/logout', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.accessToken}`
      },
      body: JSON.stringify({ refreshToken: session.refreshToken })
    })
    expect(logout.status).toBe(200)

    const capabilities = await app.request('https://auth.example.com/v1/desktop/auth/capabilities', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.accessToken}`
      },
      body: '{}'
    })
    expect(capabilities.status).toBe(401)

    const refresh = await app.request('https://auth.example.com/v1/desktop/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken })
    })
    expect(refresh.status).toBe(401)
  })

  it('ends the session on sign-out even when the client sends no refresh token', async () => {
    const { app } = await createHarness()
    const { code, state } = await signIn(app)
    const exchange = await app.request('https://auth.example.com/v1/desktop/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        codeVerifier: CODE_VERIFIER,
        nonce: 'nonce-value',
        redirectUri: REDIRECT_URI,
        state,
        localProfileId: 'local-default'
      })
    })
    const session = (await exchange.json()) as { accessToken: string }

    const logout = await app.request('https://auth.example.com/v1/desktop/auth/logout', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.accessToken}`
      },
      body: '{}'
    })
    expect(logout.status).toBe(200)

    const capabilities = await app.request('https://auth.example.com/v1/desktop/auth/capabilities', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.accessToken}`
      },
      body: '{}'
    })
    expect(capabilities.status).toBe(401)
  })

  it('keeps the sign-in brake in the database, so a restart cannot clear it', async () => {
    const { app, database } = await createHarness()

    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await signInWithPassword(app, 'wrong password')
      expect(response.status).toBe(401)
    }

    const blocked = await signInWithPassword(app, OPERATOR_PASSWORD)
    expect(blocked.status).toBe(429)

    const [row] = await database.query('SELECT * FROM auth_login_attempts')
    expect(Number(row?.['blocked_until'] ?? 0)).toBeGreaterThan(Date.now())
  })

  it('records the sign-in trail and serves it back to the signed-in caller', async () => {
    const { app } = await createHarness()
    const { code, state } = await signIn(app)
    const exchange = await app.request('https://auth.example.com/v1/desktop/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        codeVerifier: CODE_VERIFIER,
        nonce: 'nonce-value',
        redirectUri: REDIRECT_URI,
        state,
        localProfileId: 'local-default'
      })
    })
    const session = (await exchange.json()) as { accessToken: string }

    const response = await app.request('https://auth.example.com/v1/desktop/auth/audit-events', {
      headers: { authorization: `Bearer ${session.accessToken}` }
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { events: { eventType: string }[] }
    const types = body.events.map((event) => event.eventType)
    expect(types).toContain('login.succeeded')
    expect(types).toContain('session.issued')
  })

  it('does not serve the audit trail to a caller without a session', async () => {
    const { app } = await createHarness()
    const response = await app.request('https://auth.example.com/v1/desktop/auth/audit-events')
    expect(response.status).toBe(401)
  })
})
