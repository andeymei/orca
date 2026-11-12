import { describe, expect, it } from 'vitest'
import { listAuthAuditEvents, recordAuthAuditEvent, sanitizeAuditDetail } from './audit-log.js'
import { openInMemoryAuthDatabase } from './auth-database.js'

describe('auth audit log', () => {
  it('records an event with its actor and time', async () => {
    const database = await openInMemoryAuthDatabase()
    await recordAuthAuditEvent(database, {
      eventType: 'login.succeeded',
      userId: 'user_1',
      actorEmail: 'operator@example.com',
      ipAddress: '10.0.0.1'
    })

    const events = await listAuthAuditEvents(database, { actorUserId: 'user_1' })
    expect(events).toHaveLength(1)
    expect(events[0]?.eventType).toBe('login.succeeded')
    expect(events[0]?.userId).toBe('user_1')
    expect(events[0]?.actorEmail).toBe('operator@example.com')
    expect(events[0]?.ipAddress).toBe('10.0.0.1')
    expect(events[0]?.createdAt).toBeGreaterThan(0)
  })

  it('keeps a credential out of the stored detail', async () => {
    const database = await openInMemoryAuthDatabase()
    await recordAuthAuditEvent(database, {
      eventType: 'session.issued',
      userId: 'user_1',
      detail: { accessToken: 'super-secret', clientId: 'orca-desktop' }
    })

    const events = await listAuthAuditEvents(database, { actorUserId: 'user_1' })
    expect(events[0]?.detail?.['accessToken']).toBe('[redacted]')
    expect(events[0]?.detail?.['clientId']).toBe('orca-desktop')
    const [row] = await database.query('SELECT detail FROM auth_audit_events')
    expect(String(row?.['detail'])).not.toContain('super-secret')
  })

  it('filters events by actor and by time window', async () => {
    const database = await openInMemoryAuthDatabase()
    await recordAuthAuditEvent(database, {
      eventType: 'login.succeeded',
      userId: 'user_1',
      actorEmail: 'operator@example.com'
    })
    await recordAuthAuditEvent(database, {
      eventType: 'login.failed',
      actorEmail: 'intruder@example.com'
    })

    expect(await listAuthAuditEvents(database, { actorEmail: 'intruder@example.com' })).toHaveLength(1)
    expect(await listAuthAuditEvents(database, { actorUserId: 'user_1' })).toHaveLength(1)
    expect(
      await listAuthAuditEvents(database, { since: Date.now() + 60_000 })
    ).toHaveLength(0)
  })

  it('redacts secret-looking keys and truncates long values', () => {
    const sanitized = sanitizeAuditDetail({
      refreshToken: 'value',
      code_verifier: 'value',
      clientId: 'orca-desktop',
      note: 'x'.repeat(500)
    })
    expect(sanitized?.['refreshToken']).toBe('[redacted]')
    expect(sanitized?.['code_verifier']).toBe('[redacted]')
    expect(sanitized?.['clientId']).toBe('orca-desktop')
    expect(String(sanitized?.['note']).length).toBeLessThan(300)
  })
})
