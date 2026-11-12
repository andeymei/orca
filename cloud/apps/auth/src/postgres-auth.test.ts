import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAuthApp } from './app.js'
import { openAuthDatabase } from './auth-database.js'
import { createUser } from './auth-user.js'
import { loadAuthConfig } from './config.js'
import { hashPassword } from './password-hash.js'
import { createEphemeralSigningKey } from './signing-key.js'
import { createTokenSigner } from './token-signer.js'

const postgresUrl = process.env.ORCA_CLOUD_DATABASE_TEST_URL

const OPERATOR_PASSWORD = 'postgres operator password'
const REDIRECT_URI = 'http://127.0.0.1:51235/auth/callback'
const CODE_VERIFIER = randomBytes(32).toString('base64url')
const CODE_CHALLENGE = createHash('sha256').update(CODE_VERIFIER).digest('base64url')

type PostgresHarness = {
  app: Awaited<ReturnType<typeof createAuthApp>> extends never ? never : ReturnType<typeof createAuthApp>
  database: Awaited<ReturnType<typeof openAuthDatabase>>
  operatorEmail: string
  clientAddress: string
}

async function createPostgresHarness(): Promise<PostgresHarness> {
  // The database is shared by every case in this file, so each one gets its own account and
  // its own client address: the sign-in brake counts failures per account and per address.
  const operatorEmail = `postgres-operator-${randomUUID()}@example.com`
  const clientAddress = `10.42.${randomBytes(1)[0]}.${randomBytes(1)[0]}`
  const config = loadAuthConfig({
    ORCA_AUTH_PUBLIC_URL: 'https://auth.example.com',
    ORCA_AUTH_BOOTSTRAP_USER_EMAIL: operatorEmail
  } as NodeJS.ProcessEnv)
  const database = await openAuthDatabase({
    databaseUrl: postgresUrl as string,
    dataDir: await mkdtemp(join(tmpdir(), 'orca-auth-pg-'))
  })
  await createUser(database, {
    email: operatorEmail,
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
  return { app, database, operatorEmail, clientAddress }
}

function signInBody(operatorEmail: string, password: string): string {
  return new URLSearchParams({
    client_id: 'orca-desktop',
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: 'openid profile email offline_access',
    nonce: 'nonce-value',
    state: 'state-value',
    code_challenge: CODE_CHALLENGE,
    code_challenge_method: 'S256',
    local_profile_id: 'local-default',
    email: operatorEmail,
    password
  }).toString()
}

describe('auth service on PostgreSQL', () => {
  it.skipIf(!postgresUrl)('completes a sign-in and serves the capabilities back', async () => {
    const { app, operatorEmail, clientAddress } = await createPostgresHarness()

    const authorize = await app.request('https://auth.example.com/v1/desktop/auth/authorize', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-forwarded-for': clientAddress
      },
      body: signInBody(operatorEmail, OPERATOR_PASSWORD)
    })
    expect(authorize.status).toBe(302)
    const location = new URL(authorize.headers.get('location') ?? '')
    const code = location.searchParams.get('code') ?? ''
    const state = location.searchParams.get('state') ?? ''

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
      cloud: { email: string }
      capabilities: { flags: Record<string, boolean> }
    }
    expect(session.cloud.email).toBe(operatorEmail)
    expect(session.capabilities.flags['relay.use']).toBe(true)

    const capabilities = await app.request('https://auth.example.com/v1/desktop/auth/capabilities', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.accessToken}`
      },
      body: '{}'
    })
    expect(capabilities.status).toBe(200)
  })

  it.skipIf(!postgresUrl)('keeps the sign-in brake in PostgreSQL', async () => {
    const { app, database, operatorEmail, clientAddress } = await createPostgresHarness()

    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await app.request('https://auth.example.com/v1/desktop/auth/authorize', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-forwarded-for': clientAddress
        },
        body: signInBody(operatorEmail, 'wrong password')
      })
      expect(response.status).toBe(401)
    }

    const blocked = await app.request('https://auth.example.com/v1/desktop/auth/authorize', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-forwarded-for': clientAddress
      },
      body: signInBody(operatorEmail, OPERATOR_PASSWORD)
    })
    expect(blocked.status).toBe(429)

    const [row] = await database.query(
      'SELECT blocked_until FROM auth_login_attempts WHERE attempt_key = ?',
      [`email:${operatorEmail}`]
    )
    // PostgreSQL returns BIGINT as a string, so the read path has to cope with both.
    expect(Number(row?.['blocked_until'])).toBeGreaterThan(Date.now())
  })

  it.skipIf(!postgresUrl)('records audit events in PostgreSQL', async () => {
    const { app, database, operatorEmail, clientAddress } = await createPostgresHarness()

    const authorize = await app.request('https://auth.example.com/v1/desktop/auth/authorize', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-forwarded-for': clientAddress
      },
      body: signInBody(operatorEmail, OPERATOR_PASSWORD)
    })
    expect(authorize.status).toBe(302)

    const rows = await database.query(
      'SELECT event_type FROM auth_audit_events WHERE actor_email = ?',
      [operatorEmail]
    )
    expect(rows.map((row) => row['event_type'])).toContain('login.succeeded')
  })
})
