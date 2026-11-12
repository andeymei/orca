const MAX_FAILURES = 10
const BLOCK_WINDOW_MS = 5 * 60 * 1000

type AttemptState = {
  failures: number
  blockedUntil: number
}

/**
 * A shared password endpoint needs a brake; the counter lives in memory and resets on restart.
 * Callers track two independent keys — the account and the source address — because either one
 * alone leaves a wide door open.
 */
export class LoginAttemptLimiter {
  private readonly attempts = new Map<string, AttemptState>()

  constructor(private readonly now: () => number = () => Date.now()) {}

  isBlocked(email: string): boolean {
    const state = this.attempts.get(email)
    if (state === undefined) {
      return false
    }
    if (state.blockedUntil <= this.now()) {
      return false
    }
    return true
  }

  recordFailure(email: string): void {
    const state = this.attempts.get(email) ?? { failures: 0, blockedUntil: 0 }
    state.failures += 1
    if (state.failures >= MAX_FAILURES) {
      state.blockedUntil = this.now() + BLOCK_WINDOW_MS
      state.failures = 0
    }
    this.attempts.set(email, state)
  }

  recordSuccess(email: string): void {
    this.attempts.delete(email)
  }
}
