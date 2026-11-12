import { createHash, createHmac } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { listAuthAuditEvents, recordAuthAuditEvent } from './audit-log.js'
import {
  consumeAuthorizationCode,
  issueAuthorizationCode,
  purgeExpiredAuthorizationCodes
} from './authorization-code.js'
import { parseAuthorizationRequest, type AuthorizationRequest } from './authorization-request.js'
import { findUserByEmail, findUserById } from './auth-user.js'
import type { AuthDatabase } from './auth-database.js'
import {
  createCloudProfile,
  describeCloudProfile,
  ensurePersonalOrganization,
  findOrCreateCloudProfile,
  listOrganizations,
  setActiveOrganization
} from './cloud-profile.js'
import type { AuthConfig } from './config.js'
import { decodeHostPublicKey, deriveRelayHostId, newSecret } from './auth-identity.js'
import { LoginAttemptStore } from './login-attempt-store.js'
import { renderLoginPage } from './login-page.js'
import { hashPassword, verifyPassword } from './password-hash.js'
import {
  clearedLoginCookieHeader,
  loginCookieHeader,
  readLoginCookieValue
} from './session-cookie.js'
import {
  createSession,
  isSessionActive,
  revokeSession,
  revokeSessionById,
  rotateSession,
  sessionBelongsToUser,
  type SessionGrant
} from './session-store.js'
import { jwksDocument, type SigningKey } from './signing-key.js'
import type { TokenSigner } from './token-signer.js'

const AUTHORIZE_PATH = '/v1/desktop/auth/authorize'
const LOGIN_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000

export type AuthAppInput = {
  config: AuthConfig
  database: AuthDatabase
  signer: TokenSigner
  signingKey: SigningKey
  sessionSecret: string
}

function authorizationFields(request: AuthorizationRequest): Record<string, string> {
  return {
    client_id: request.clientId,
    response_type: 'code',
    redirect_uri: request.redirectUri,
    scope: request.scope,
    nonce: request.nonce,
    state: request.state,
    code_challenge: request.codeChallenge,
    code_challenge_method: request.codeChallengeMethod,
    ...(request.localProfileId === undefined ? {} : { local_profile_id: request.localProfileId })
  }
}

function readStringField(body: unknown, field: string): string {
  if (body === null || typeof body !== 'object') {
    return ''
  }
  const value = (body as Record<string, unknown>)[field]
  return typeof value === 'string' ? value.trim() : ''
}

function readNumberQuery(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function errorPayload(code: string): { error: string } {
  return { error: code }
}

function pkceChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url')
}

function clientAddress(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) {
      return first
    }
  }
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
    ?.incoming
  return incoming?.socket?.remoteAddress ?? 'unknown'
}

export function createAuthApp(input: AuthAppInput): Hono {
  const { config, database, signer } = input
  const limiter = new LoginAttemptStore(database)
  const app = new Hono()
  const refreshTokenKey = createHmac('sha256', input.sessionSecret)
    .update('orca-auth-refresh')
    .digest()
  const cookieSecure = new URL(config.publicUrl).protocol === 'https:'
  let dummyHash: Promise<string> | null = null
  let lastCleanupAt = 0

  const issuerInput = {
    audience: config.accessTokenAudience,
    accessTokenTtlMs: config.accessTokenTtlMs,
    refreshTokenTtlMs: config.refreshTokenTtlMs,
    refreshRotationGraceMs: config.refreshRotationGraceMs,
    refreshTokenKey,
    signer
  }

  // A missing account must cost the same as a wrong password, or the endpoint enumerates users.
  function dummyPasswordHash(): Promise<string> {
    dummyHash ??= hashPassword(newSecret(24))
    return dummyHash
  }

  async function sessionPayload(grant: SessionGrant): Promise<Record<string, unknown>> {
    const cloud = await describeCloudProfile(database, grant.cloudProfileId)
    if (!cloud) {
      throw new Error('orca_auth_cloud_profile_missing')
    }
    const organizations = await listOrganizations(database, grant.userId)
    return {
      accessToken: grant.tokens.accessToken,
      refreshToken: grant.tokens.refreshToken,
      expiresAt: grant.tokens.expiresAt,
      cloud,
      organizations,
      capabilities: { flags: config.capabilityFlags, refreshedAt: Date.now() }
    }
  }

  async function requireAccessToken(c: Context): Promise<{
    userId: string
    cloudProfileId: string
    sessionId: string
  } | null> {
    const header = c.req.header('authorization') ?? ''
    const match = /^Bearer ([^\s]+)$/.exec(header)
    if (!match?.[1]) {
      return null
    }
    const claims = await signer.verifyAccessToken(match[1], config.accessTokenAudience)
    if (!claims) {
      return null
    }
    // A signed access token outlives a sign-out unless the session behind it is checked.
    if (!(await isSessionActive(database, claims.sessionId))) {
      return null
    }
    return claims
  }

  async function issueCodeAndRedirect(
    c: Context,
    request: AuthorizationRequest,
    userId: string
  ): Promise<Response> {
    const code = await issueAuthorizationCode(
      database,
      {
        userId,
        clientId: request.clientId,
        redirectUri: request.redirectUri,
        codeChallenge: request.codeChallenge,
        nonce: request.nonce,
        state: request.state,
        ...(request.localProfileId === undefined
          ? {}
          : { localProfileId: request.localProfileId })
      },
      config.authorizationCodeTtlMs
    )
    const location = new URL(request.redirectUri)
    location.searchParams.set('code', code)
    location.searchParams.set('state', request.state)
    return c.redirect(location.toString(), 302)
  }

  app.use('*', async (c, next) => {
    await next()
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('X-Frame-Options', 'DENY')
  })

  app.get('/health', (c) => c.json({ status: 'ok' }))
  app.get('/ready', async (c) => {
    try {
      await database.query('SELECT 1')
      return c.json({ status: 'ready' })
    } catch {
      return c.json({ status: 'unavailable' }, 503)
    }
  })
  app.get(config.jwksPath, (c) => c.json(jwksDocument(input.signingKey)))

  app.get(AUTHORIZE_PATH, async (c) => {
    const request = parseAuthorizationRequest(c.req.query(), config.clientId)
    if (!request) {
      return c.text('invalid authorization request', 400)
    }
    const cookieUserId = readLoginCookieValue(c.req.header('cookie'), input.sessionSecret)
    if (cookieUserId !== null) {
      const user = await findUserById(database, cookieUserId)
      if (user) {
        // The redirect target is a loopback listener the desktop opened, so the code cannot leave
        // the machine that started the flow; PKCE binds it to whoever holds the verifier.
        return await issueCodeAndRedirect(c, request, user.userId)
      }
    }
    c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'")
    c.header('Cache-Control', 'no-store')
    return c.html(
      renderLoginPage({ action: AUTHORIZE_PATH, fields: authorizationFields(request) })
    )
  })

  app.post(AUTHORIZE_PATH, async (c) => {
    const form = await c.req.parseBody()
    const fields: Record<string, string> = {}
    for (const [key, value] of Object.entries(form)) {
      if (typeof value === 'string') {
        fields[key] = value
      }
    }
    const request = parseAuthorizationRequest(fields, config.clientId)
    if (!request) {
      return c.text('invalid authorization request', 400)
    }
    const page = (error?: string): Response => {
      c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'")
      c.header('Cache-Control', 'no-store')
      return c.html(
        renderLoginPage({
          action: AUTHORIZE_PATH,
          fields: authorizationFields(request),
          ...(error === undefined ? {} : { error })
        }),
        error === undefined ? 200 : 401
      )
    }
    if ((fields['cancel'] ?? '') !== '') {
      const location = new URL(request.redirectUri)
      location.searchParams.set('error', 'access_denied')
      location.searchParams.set('state', request.state)
      return c.redirect(location.toString(), 302)
    }
    const email = (fields['email'] ?? '').trim().toLowerCase()
    const password = fields['password'] ?? ''
    if (email.length === 0 || password.length === 0) {
      return page('Enter an email and a password.')
    }
    const address = clientAddress(c)
    if ((await limiter.isBlocked(`email:${email}`)) || (await limiter.isBlocked(`ip:${address}`))) {
      await recordAuthAuditEvent(database, {
        eventType: 'login.blocked',
        actorEmail: email,
        ipAddress: address
      })
      return c.text('too many sign-in attempts', 429)
    }
    const user = await findUserByEmail(database, email)
    const storedHash = user?.passwordHash ?? (await dummyPasswordHash())
    const passwordMatches = await verifyPassword(password, storedHash)
    if (!user || !passwordMatches) {
      await limiter.recordFailure(`email:${email}`)
      await limiter.recordFailure(`ip:${address}`)
      await recordAuthAuditEvent(database, {
        eventType: 'login.failed',
        actorEmail: email,
        ipAddress: address,
        detail: { reason: 'invalid_credentials' }
      })
      return page('Invalid email or password.')
    }
    await limiter.recordSuccess(`email:${email}`)
    await limiter.recordSuccess(`ip:${address}`)
    await recordAuthAuditEvent(database, {
      eventType: 'login.succeeded',
      userId: user.userId,
      actorEmail: email,
      ipAddress: address,
      detail: { clientId: request.clientId }
    })
    c.header(
      'Set-Cookie',
      loginCookieHeader(user.userId, input.sessionSecret, LOGIN_COOKIE_MAX_AGE_SECONDS, cookieSecure)
    )
    return await issueCodeAndRedirect(c, request, user.userId)
  })

  app.post('/v1/desktop/auth/session', async (c) => {
    const body = await c.req.json().catch(() => null)
    const code = readStringField(body, 'code')
    const codeVerifier = readStringField(body, 'codeVerifier')
    const nonce = readStringField(body, 'nonce')
    const redirectUri = readStringField(body, 'redirectUri')
    const state = readStringField(body, 'state')
    const localProfileId = readStringField(body, 'localProfileId')
    if (code.length === 0 || codeVerifier.length === 0) {
      return c.json(errorPayload('invalid_grant'), 400)
    }
    const grant =
      code.length === 0
        ? null
        : await consumeAuthorizationCode(database, code, {
            clientId: config.clientId,
            redirectUri,
            state,
            nonce,
            codeChallenge: pkceChallenge(codeVerifier),
            ...(localProfileId.length > 0 ? { localProfileId } : {})
          })
    if (!grant) {
      return c.json(errorPayload('invalid_grant'), 400)
    }
    const user = await findUserById(database, grant.userId)
    if (!user) {
      return c.json(errorPayload('invalid_grant'), 400)
    }
    await purgeExpiredRecords()
    const orgId = await ensurePersonalOrganization(database, user.userId)
    const cloudProfileId = await findOrCreateCloudProfile(database, {
      userId: user.userId,
      ...(user.displayName === undefined ? {} : { displayName: user.displayName }),
      activeOrgId: orgId
    })
    const session = await createSession(database, {
      ...issuerInput,
      userId: user.userId,
      cloudProfileId
    })
    await recordAuthAuditEvent(database, {
      eventType: 'session.issued',
      userId: user.userId,
      actorEmail: user.email,
      ipAddress: clientAddress(c),
      detail: { cloudProfileId }
    })
    return c.json(await sessionPayload(session))
  })

  app.post('/v1/desktop/auth/refresh', async (c) => {
    const body = await c.req.json().catch(() => null)
    const refreshToken = readStringField(body, 'refreshToken')
    if (refreshToken.length === 0) {
      return c.json(errorPayload('invalid_refresh_token'), 401)
    }
    const grant = await rotateSession(database, { ...issuerInput, refreshToken })
    if (!grant) {
      return c.json(errorPayload('invalid_refresh_token'), 401)
    }
    await recordAuthAuditEvent(database, {
      eventType: 'session.refreshed',
      userId: grant.userId,
      ipAddress: clientAddress(c)
    })
    return c.json(await sessionPayload(grant))
  })

  app.post('/v1/desktop/auth/capabilities', async (c) => {
    const claims = await requireAccessToken(c)
    if (!claims) {
      return c.json(errorPayload('invalid_access_token'), 401)
    }
    const cloud = await describeCloudProfile(database, claims.cloudProfileId)
    const organizations = await listOrganizations(database, claims.userId)
    return c.json({
      ...(cloud === null ? {} : { cloud }),
      organizations,
      capabilities: { flags: config.capabilityFlags, refreshedAt: Date.now() }
    })
  })

  app.post('/v1/desktop/auth/profile', async (c) => {
    const claims = await requireAccessToken(c)
    if (!claims) {
      return c.json(errorPayload('invalid_access_token'), 401)
    }
    const body = await c.req.json().catch(() => null)
    const refreshToken = readStringField(body, 'refreshToken')
    const orgId = readStringField(body, 'orgId')
    const name = readStringField(body, 'name')
    if (!(await sessionBelongsToUser(database, refreshToken, claims.userId))) {
      return c.json(errorPayload('invalid_refresh_token'), 401)
    }
    const activeOrgId =
      orgId.length > 0 ? orgId : await ensurePersonalOrganization(database, claims.userId)
    const cloudProfileId = await createCloudProfile(database, {
      userId: claims.userId,
      ...(name.length > 0 ? { displayName: name } : {}),
      activeOrgId
    })
    const grant = await createSession(database, {
      ...issuerInput,
      userId: claims.userId,
      cloudProfileId
    })
    await recordAuthAuditEvent(database, {
      eventType: 'profile.created',
      userId: claims.userId,
      ipAddress: clientAddress(c),
      detail: { cloudProfileId }
    })
    return c.json(await sessionPayload(grant))
  })

  app.post('/v1/desktop/auth/org', async (c) => {
    const claims = await requireAccessToken(c)
    if (!claims) {
      return c.json(errorPayload('invalid_access_token'), 401)
    }
    const body = await c.req.json().catch(() => null)
    const orgId = readStringField(body, 'orgId')
    const organizations = await listOrganizations(database, claims.userId)
    if (!organizations.some((organization) => organization.orgId === orgId)) {
      return c.json(errorPayload('org_not_found'), 404)
    }
    await setActiveOrganization(database, claims.cloudProfileId, orgId)
    await recordAuthAuditEvent(database, {
      eventType: 'organization.changed',
      userId: claims.userId,
      ipAddress: clientAddress(c),
      detail: { orgId }
    })
    const cloud = await describeCloudProfile(database, claims.cloudProfileId)
    return c.json({
      ...(cloud === null ? {} : { cloud }),
      organizations,
      capabilities: { flags: config.capabilityFlags, refreshedAt: Date.now() }
    })
  })

  app.post('/v1/desktop/auth/logout', async (c) => {
    const claims = await requireAccessToken(c)
    if (!claims) {
      return c.json(errorPayload('invalid_access_token'), 401)
    }
    const body = await c.req.json().catch(() => null)
    const refreshToken = readStringField(body, 'refreshToken')
    // The access token names the session, so a sign-out without a refresh token still ends it.
    await revokeSessionById(database, claims.sessionId)
    if (
      refreshToken.length > 0 &&
      (await sessionBelongsToUser(database, refreshToken, claims.userId))
    ) {
      await revokeSession(database, refreshToken)
    }
    c.header('Set-Cookie', clearedLoginCookieHeader(cookieSecure))
    await recordAuthAuditEvent(database, {
      eventType: 'session.revoked',
      userId: claims.userId,
      ipAddress: clientAddress(c)
    })
    return c.json({ ok: true })
  })

  app.post('/v1/desktop/auth/relay-token', async (c) => {
    const claims = await requireAccessToken(c)
    if (!claims) {
      return c.json(errorPayload('invalid_access_token'), 401)
    }
    const body = await c.req.json().catch(() => null)
    const relayHostId = readStringField(body, 'relayHostId')
    const hostPublicKeyB64 = readStringField(body, 'hostPublicKeyB64')
    const hostPublicKey = decodeHostPublicKey(hostPublicKeyB64)
    if (!hostPublicKey) {
      return c.json(errorPayload('invalid_host_public_key'), 400)
    }
    if (deriveRelayHostId(hostPublicKey) !== relayHostId) {
      return c.json(errorPayload('relay_host_id_mismatch'), 400)
    }
    const cloud = await describeCloudProfile(database, claims.cloudProfileId)
    const minted = await signer.mintRelayToken({
      userId: claims.userId,
      cloudProfileId: claims.cloudProfileId,
      ...(cloud?.activeOrgId === undefined ? {} : { orgId: cloud.activeOrgId }),
      relayHostId,
      ttlMs: config.relayTokenTtlMs,
      audience: config.relayTokenAudience
    })
    await recordAuthAuditEvent(database, {
      eventType: 'relay_token.issued',
      userId: claims.userId,
      ipAddress: clientAddress(c),
      detail: { relayHostId }
    })
    return c.json({ relayToken: minted.token, expiresAt: minted.expiresAt })
  })

  app.post('/v1/desktop/auth/connector-token', (c) =>
    c.json(errorPayload('connector_not_supported'), 501)
  )

  // The signed-in client reads its own trail: which sign-ins, token issuances and org
  // switches happened, and when. A caller never sees another account's events.
  app.get('/v1/desktop/auth/audit-events', async (c) => {
    const claims = await requireAccessToken(c)
    if (!claims) {
      return c.json(errorPayload('invalid_access_token'), 401)
    }
    const user = await findUserById(database, claims.userId)
    const since = readNumberQuery(c.req.query('since'))
    const until = readNumberQuery(c.req.query('until'))
    const limit = readNumberQuery(c.req.query('limit'))
    const events = await listAuthAuditEvents(database, {
      actorUserId: claims.userId,
      ...(user === null ? {} : { actorEmail: user.email }),
      ...(since === undefined ? {} : { since }),
      ...(until === undefined ? {} : { until }),
      ...(limit === undefined ? {} : { limit })
    })
    return c.json({ events })
  })

  app.get('/v1/desktop/orgs/:orgId/members', async (c) => {
    const claims = await requireAccessToken(c)
    if (!claims) {
      return c.json(errorPayload('invalid_access_token'), 401)
    }
    const orgId = c.req.param('orgId')
    const organizations = await listOrganizations(database, claims.userId)
    if (!organizations.some((organization) => organization.orgId === orgId)) {
      return c.json(errorPayload('org_not_found'), 404)
    }
    return c.json({
      members: [],
      pendingInvites: [],
      viewerRole: 'owner',
      canManageMembers: false
    })
  })

  for (const path of [
    '/v1/desktop/orgs/:orgId/invites',
    '/v1/desktop/orgs/:orgId/invites/revoke',
    '/v1/desktop/orgs/:orgId/members/role',
    '/v1/desktop/orgs/:orgId/members/remove'
  ]) {
    app.post(path, async (c) => {
      const claims = await requireAccessToken(c)
      if (!claims) {
        return c.json(errorPayload('invalid_access_token'), 401)
      }
      return c.json(errorPayload('org_management_not_supported'), 501)
    })
  }

  async function purgeExpiredRecords(): Promise<void> {
    const now = Date.now()
    if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) {
      return
    }
    lastCleanupAt = now
    await purgeExpiredAuthorizationCodes(database, now - 60 * 60 * 1000)
    await database.query('DELETE FROM auth_sessions WHERE refresh_expires_at < ?', [
      now - 7 * 24 * 60 * 60 * 1000
    ])
    await limiter.purgeStale(now - 24 * 60 * 60 * 1000)
  }

  return app
}
