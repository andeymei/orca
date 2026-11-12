import type { AuthDatabase } from './auth-database.js'
import { readNumber } from './record-value.js'

const DEFAULT_MAX_FAILURES = 10
const DEFAULT_BLOCK_WINDOW_MS = 5 * 60 * 1000

export type LoginAttemptStoreOptions = {
  now?: () => number
  maxFailures?: number
  blockWindowMs?: number
}

/**
 * The brake on a shared password endpoint. The counter lives in the database, so a restart
 * does not hand an attacker a fresh budget of guesses. Callers track two independent keys —
 * the account and the source address — because either one alone leaves a wide door open.
 */
export class LoginAttemptStore {
  private readonly now: () => number
  private readonly maxFailures: number
  private readonly blockWindowMs: number

  constructor(
    private readonly database: AuthDatabase,
    options: LoginAttemptStoreOptions = {}
  ) {
    this.now = options.now ?? (() => Date.now())
    this.maxFailures = options.maxFailures ?? DEFAULT_MAX_FAILURES
    this.blockWindowMs = options.blockWindowMs ?? DEFAULT_BLOCK_WINDOW_MS
  }

  async isBlocked(key: string): Promise<boolean> {
    const [row] = await this.database.query(
      'SELECT blocked_until FROM auth_login_attempts WHERE attempt_key = ?',
      [key]
    )
    if (!row) {
      return false
    }
    return readNumber(row, 'blocked_until') > this.now()
  }

  /** Counts one failure and reports whether this failure tripped the ban. */
  async recordFailure(key: string): Promise<boolean> {
    const now = this.now()
    let blocked = false
    await this.database.transaction(async (transaction) => {
      // The insert only seeds the row; the update below is what counts, so a repeat call
      // cannot reset the counter by re-inserting it.
      await transaction.query(
        'INSERT INTO auth_login_attempts (attempt_key, failures, blocked_until, updated_at) VALUES (?, 0, 0, ?) ON CONFLICT (attempt_key) DO NOTHING',
        [key, now]
      )
      await transaction.query(
        'UPDATE auth_login_attempts SET failures = failures + 1, updated_at = ? WHERE attempt_key = ?',
        [now, key]
      )
      const [row] = await transaction.query(
        'SELECT failures FROM auth_login_attempts WHERE attempt_key = ?',
        [key]
      )
      if (row && readNumber(row, 'failures') >= this.maxFailures) {
        blocked = true
        await transaction.query(
          'UPDATE auth_login_attempts SET blocked_until = ?, failures = 0, updated_at = ? WHERE attempt_key = ?',
          [now + this.blockWindowMs, now, key]
        )
      }
    })
    return blocked
  }

  async recordSuccess(key: string): Promise<void> {
    await this.database.query('DELETE FROM auth_login_attempts WHERE attempt_key = ?', [key])
  }

  /** Drops counters that can no longer block anything, so the table stays small. */
  async purgeStale(before: number): Promise<void> {
    await this.database.query('DELETE FROM auth_login_attempts WHERE updated_at < ?', [before])
  }
}
