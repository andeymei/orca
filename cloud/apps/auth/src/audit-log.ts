import type { AuthDatabase } from './auth-database.js'
import { newIdentifier } from './auth-identity.js'
import { readNumber, readOptionalString } from './record-value.js'

export type AuthAuditEventType =
  | 'login.succeeded'
  | 'login.failed'
  | 'login.blocked'
  | 'session.issued'
  | 'session.refreshed'
  | 'session.revoked'
  | 'relay_token.issued'
  | 'profile.created'
  | 'organization.changed'

export type AuthAuditEvent = {
  eventId: string
  userId?: string
  actorEmail?: string
  eventType: AuthAuditEventType
  ipAddress?: string
  detail?: Record<string, unknown>
  createdAt: number
}

export type AuthAuditEventInput = {
  eventType: AuthAuditEventType
  userId?: string
  actorEmail?: string
  ipAddress?: string
  detail?: Record<string, unknown>
}

export type AuthAuditEventQuery = {
  /** Matches events whose subject is this user or whose actor is this address, whichever hits. */
  actorUserId?: string
  actorEmail?: string
  since?: number
  until?: number
  limit?: number
}

const MAX_DETAIL_KEYS = 20
const MAX_DETAIL_VALUE_LENGTH = 256
const REDACTED = '[redacted]'
// A detail field that looks like a credential must never reach the log or the table.
const SECRET_KEY_PATTERN = /(token|password|secret|authorization|cookie|code_verifier|private)/i

function sanitizeDetailValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_DETAIL_VALUE_LENGTH
      ? `${value.slice(0, MAX_DETAIL_VALUE_LENGTH)}…`
      : value
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value
  }
  if (value === undefined) {
    return undefined
  }
  return REDACTED
}

export function sanitizeAuditDetail(
  detail: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!detail) {
    return undefined
  }
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(detail).slice(0, MAX_DETAIL_KEYS)) {
    sanitized[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : sanitizeDetailValue(value)
  }
  return sanitized
}

/**
 * Records a security-relevant event. The write is best-effort: a full audit table must not
 * turn a sign-in into an outage, but a failed write is always reported.
 */
export async function recordAuthAuditEvent(
  database: AuthDatabase,
  input: AuthAuditEventInput
): Promise<AuthAuditEvent> {
  const createdAt = Date.now()
  const eventId = newIdentifier('evt')
  const detail = sanitizeAuditDetail(input.detail)
  try {
    await database.query(
      'INSERT INTO auth_audit_events (event_id, user_id, actor_email, event_type, ip_address, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        eventId,
        input.userId ?? null,
        input.actorEmail ?? null,
        input.eventType,
        input.ipAddress ?? null,
        detail === undefined ? null : JSON.stringify(detail),
        createdAt
      ]
    )
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'orca_auth_audit_write_failed',
        eventType: input.eventType,
        reason: error instanceof Error ? error.message : 'unknown'
      })
    )
  }
  console.info(
    JSON.stringify({
      event: 'orca_auth_audit',
      eventId,
      eventType: input.eventType,
      userId: input.userId ?? null,
      actorEmail: input.actorEmail ?? null,
      ipAddress: input.ipAddress ?? null,
      ...(detail === undefined ? {} : { detail }),
      createdAt
    })
  )
  return {
    eventId,
    ...(input.userId === undefined ? {} : { userId: input.userId }),
    ...(input.actorEmail === undefined ? {} : { actorEmail: input.actorEmail }),
    eventType: input.eventType,
    ...(input.ipAddress === undefined ? {} : { ipAddress: input.ipAddress }),
    ...(detail === undefined ? {} : { detail }),
    createdAt
  }
}

function toAuthAuditEvent(row: Record<string, unknown>): AuthAuditEvent {
  const detailText = readOptionalString(row, 'detail')
  return {
    eventId: readOptionalString(row, 'event_id') ?? '',
    ...(readOptionalString(row, 'user_id') === undefined
      ? {}
      : { userId: readOptionalString(row, 'user_id') as string }),
    ...(readOptionalString(row, 'actor_email') === undefined
      ? {}
      : { actorEmail: readOptionalString(row, 'actor_email') as string }),
    eventType: (readOptionalString(row, 'event_type') ?? 'unknown') as AuthAuditEventType,
    ...(readOptionalString(row, 'ip_address') === undefined
      ? {}
      : { ipAddress: readOptionalString(row, 'ip_address') as string }),
    ...(detailText === undefined
      ? {}
      : { detail: JSON.parse(detailText) as Record<string, unknown> }),
    createdAt: readNumber(row, 'created_at')
  }
}

export async function listAuthAuditEvents(
  database: AuthDatabase,
  query: AuthAuditEventQuery
): Promise<AuthAuditEvent[]> {
  const conditions: string[] = []
  const params: unknown[] = []
  if (query.actorUserId !== undefined || query.actorEmail !== undefined) {
    const actorConditions: string[] = []
    const actorParams: unknown[] = []
    if (query.actorUserId !== undefined) {
      actorConditions.push('user_id = ?')
      actorParams.push(query.actorUserId)
    }
    if (query.actorEmail !== undefined) {
      actorConditions.push('actor_email = ?')
      actorParams.push(query.actorEmail)
    }
    conditions.push(`(${actorConditions.join(' OR ')})`)
    params.push(...actorParams)
  }
  if (query.since !== undefined) {
    conditions.push('created_at >= ?')
    params.push(query.since)
  }
  if (query.until !== undefined) {
    conditions.push('created_at <= ?')
    params.push(query.until)
  }
  const where = conditions.length === 0 ? '' : ` WHERE ${conditions.join(' AND ')}`
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 500)
  const rows = await database.query(
    `SELECT * FROM auth_audit_events${where} ORDER BY created_at DESC, event_id DESC LIMIT ?`,
    [...params, limit]
  )
  return rows.map(toAuthAuditEvent)
}
