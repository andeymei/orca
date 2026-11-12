import { z } from 'zod'

export type AuthConfig = {
  port: number
  publicUrl: string
  issuer: string
  clientId: string
  jwksPath: string
  databaseUrl?: string
  dataDir: string
  databasePoolMax: number
  accessTokenTtlMs: number
  refreshTokenTtlMs: number
  relayTokenTtlMs: number
  refreshRotationGraceMs: number
  authorizationCodeTtlMs: number
  signingKeyPem?: string
  signingKeyPath: string
  sessionCookieSecret?: string
  bootstrapUserEmail?: string
  bootstrapUserPassword?: string
  capabilityFlags: Record<string, boolean>
  accessTokenAudience: string
  relayTokenAudience: string
}

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])

function isServiceOrigin(value: string): boolean {
  try {
    const parsed = new URL(value)
    if (parsed.origin !== value) {
      return false
    }
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && loopbackHosts.has(parsed.hostname))
  } catch {
    return false
  }
}

function isServicePath(value: string): boolean {
  return value.startsWith('/') && !value.includes('..') && !value.includes('?') && !value.includes('#')
}

const CapabilityFlagsSchema = z.record(z.string(), z.boolean())

const EnvironmentSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  ORCA_AUTH_PUBLIC_URL: z.string().refine(isServiceOrigin, 'Expected a canonical HTTPS service origin'),
  ORCA_AUTH_CLIENT_ID: z.string().min(1).default('orca-desktop'),
  ORCA_AUTH_JWKS_PATH: z
    .string()
    .default('/.well-known/jwks.json')
    .refine(isServicePath, 'Expected an absolute path'),
  ORCA_AUTH_DATABASE_URL: z.string().optional(),
  ORCA_AUTH_DATA_DIR: z.string().default('./data/auth'),
  ORCA_AUTH_DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).optional(),
  ORCA_AUTH_ACCESS_TOKEN_TTL_MS: z.coerce.number().int().positive().default(15 * MINUTE_MS),
  ORCA_AUTH_REFRESH_TOKEN_TTL_MS: z.coerce.number().int().positive().default(30 * DAY_MS),
  ORCA_AUTH_RELAY_TOKEN_TTL_MS: z.coerce.number().int().positive().default(5 * MINUTE_MS),
  // The desktop replays a refresh it never got an answer for; the server must honor the old token this long.
  ORCA_AUTH_REFRESH_ROTATION_GRACE_MS: z.coerce.number().int().positive().default(MINUTE_MS),
  ORCA_AUTH_AUTHORIZATION_CODE_TTL_MS: z.coerce.number().int().positive().default(MINUTE_MS),
  ORCA_AUTH_SIGNING_KEY_PEM: z.string().optional(),
  ORCA_AUTH_SIGNING_KEY_PATH: z.string().optional(),
  ORCA_AUTH_SESSION_COOKIE_SECRET: z.string().min(32).optional(),
  ORCA_AUTH_BOOTSTRAP_USER_EMAIL: z.string().optional(),
  ORCA_AUTH_BOOTSTRAP_USER_PASSWORD: z.string().optional(),
  ORCA_AUTH_CAPABILITY_FLAGS: z.string().optional(),
  ORCA_AUTH_ACCESS_TOKEN_AUDIENCE: z.string().min(1).default('orca-desktop'),
  ORCA_AUTH_RELAY_TOKEN_AUDIENCE: z.string().min(1).default('orca-relay')
})

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const parsed = EnvironmentSchema.parse(env)
  const dataDir = parsed.ORCA_AUTH_DATA_DIR
  const capabilityFlags = parseCapabilityFlags(parsed.ORCA_AUTH_CAPABILITY_FLAGS)
  return {
    port: parsed.PORT,
    publicUrl: parsed.ORCA_AUTH_PUBLIC_URL,
    issuer: parsed.ORCA_AUTH_PUBLIC_URL,
    clientId: parsed.ORCA_AUTH_CLIENT_ID,
    jwksPath: parsed.ORCA_AUTH_JWKS_PATH,
    ...(parsed.ORCA_AUTH_DATABASE_URL === undefined
      ? {}
      : { databaseUrl: parsed.ORCA_AUTH_DATABASE_URL }),
    dataDir,
    databasePoolMax: parsed.ORCA_AUTH_DATABASE_POOL_MAX ?? 10,
    accessTokenTtlMs: parsed.ORCA_AUTH_ACCESS_TOKEN_TTL_MS,
    refreshTokenTtlMs: parsed.ORCA_AUTH_REFRESH_TOKEN_TTL_MS,
    relayTokenTtlMs: parsed.ORCA_AUTH_RELAY_TOKEN_TTL_MS,
    refreshRotationGraceMs: parsed.ORCA_AUTH_REFRESH_ROTATION_GRACE_MS,
    authorizationCodeTtlMs: parsed.ORCA_AUTH_AUTHORIZATION_CODE_TTL_MS,
    ...(parsed.ORCA_AUTH_SIGNING_KEY_PEM === undefined
      ? {}
      : { signingKeyPem: parsed.ORCA_AUTH_SIGNING_KEY_PEM }),
    signingKeyPath: parsed.ORCA_AUTH_SIGNING_KEY_PATH ?? `${dataDir}/orca-auth-signing-key.pem`,
    // An unset secret is generated and persisted at boot so single-host deployments work unattended.
    ...(parsed.ORCA_AUTH_SESSION_COOKIE_SECRET === undefined
      ? {}
      : { sessionCookieSecret: parsed.ORCA_AUTH_SESSION_COOKIE_SECRET }),
    ...(parsed.ORCA_AUTH_BOOTSTRAP_USER_EMAIL === undefined
      ? {}
      : { bootstrapUserEmail: parsed.ORCA_AUTH_BOOTSTRAP_USER_EMAIL }),
    ...(parsed.ORCA_AUTH_BOOTSTRAP_USER_PASSWORD === undefined
      ? {}
      : { bootstrapUserPassword: parsed.ORCA_AUTH_BOOTSTRAP_USER_PASSWORD }),
    capabilityFlags,
    accessTokenAudience: parsed.ORCA_AUTH_ACCESS_TOKEN_AUDIENCE,
    relayTokenAudience: parsed.ORCA_AUTH_RELAY_TOKEN_AUDIENCE
  }
}

export function parseCapabilityFlags(raw: string | undefined): Record<string, boolean> {
  if (raw === undefined) {
    return { 'relay.use': true }
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    throw new Error('orca_auth_capability_flags_invalid')
  }
  const parsed = CapabilityFlagsSchema.safeParse(decoded)
  if (!parsed.success) {
    throw new Error('orca_auth_capability_flags_invalid')
  }
  return parsed.data
}
