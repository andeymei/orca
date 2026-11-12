import { describe, expect, it } from 'vitest'
import { openInMemoryAuthDatabase } from './auth-database.js'
import { LoginAttemptStore } from './login-attempt-store.js'

describe('LoginAttemptStore', () => {
  it('blocks a key after the failure budget is spent', async () => {
    const database = await openInMemoryAuthDatabase()
    const store = new LoginAttemptStore(database, { maxFailures: 3, blockWindowMs: 60_000 })

    expect(await store.isBlocked('email:operator@example.com')).toBe(false)
    expect(await store.recordFailure('email:operator@example.com')).toBe(false)
    expect(await store.recordFailure('email:operator@example.com')).toBe(false)
    expect(await store.recordFailure('email:operator@example.com')).toBe(true)
    expect(await store.isBlocked('email:operator@example.com')).toBe(true)
  })

  it('keeps the ban when a new store takes over, so a restart cannot clear it', async () => {
    const database = await openInMemoryAuthDatabase()
    const store = new LoginAttemptStore(database, { maxFailures: 2, blockWindowMs: 60_000 })
    await store.recordFailure('ip:10.0.0.1')
    await store.recordFailure('ip:10.0.0.1')

    // A restart means a fresh limiter instance over the same database.
    const afterRestart = new LoginAttemptStore(database, { maxFailures: 2, blockWindowMs: 60_000 })
    expect(await afterRestart.isBlocked('ip:10.0.0.1')).toBe(true)
  })

  it('clears the counter after a successful sign-in', async () => {
    const database = await openInMemoryAuthDatabase()
    const store = new LoginAttemptStore(database, { maxFailures: 2, blockWindowMs: 60_000 })
    await store.recordFailure('email:operator@example.com')
    await store.recordSuccess('email:operator@example.com')
    expect(await store.isBlocked('email:operator@example.com')).toBe(false)
  })

  it('releases the block once the window has passed', async () => {
    const database = await openInMemoryAuthDatabase()
    let now = 1_000_000
    const store = new LoginAttemptStore(database, {
      maxFailures: 1,
      blockWindowMs: 5_000,
      now: () => now
    })
    await store.recordFailure('email:operator@example.com')
    expect(await store.isBlocked('email:operator@example.com')).toBe(true)

    now += 5_001
    expect(await store.isBlocked('email:operator@example.com')).toBe(false)
  })

  it('drops counters that can no longer block anything', async () => {
    const database = await openInMemoryAuthDatabase()
    const store = new LoginAttemptStore(database, { maxFailures: 5 })
    await store.recordFailure('email:operator@example.com')

    await store.purgeStale(Date.now() + 1)
    const [row] = await database.query('SELECT * FROM auth_login_attempts')
    expect(row).toBeUndefined()
  })
})
