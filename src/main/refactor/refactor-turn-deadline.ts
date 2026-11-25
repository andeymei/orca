/**
 * A turn that says nothing for this long is killed: the agent gets no second chance at the same
 * file.
 *
 * Why it is a silence and not a length: a turn that keeps working is worth waiting for, and the
 * agent's own messages are the proof that it is alive.
 */
export const REFACTOR_TURN_IDLE_TIMEOUT_MS = 300_000

/**
 * The ceiling of a turn, however busy it is.
 *
 * Why it exists: a turn that keeps talking without ever finishing would otherwise run forever.
 */
export const REFACTOR_TURN_MAX_MS = 900_000

/**
 * The deadlines of a turn.
 *
 * Why two of them: the silence ends a turn that stopped talking, and the ceiling ends a turn
 * that keeps talking without finishing.
 */
export type RefactorTurnDeadline = {
  /** Starts both deadlines. */
  start(): void
  /** Says the agent is alive; the silence starts over. */
  alive(): void
  /** Stops both deadlines. */
  stop(): void
}

/** The deadlines of one turn. */
export function refactorTurnDeadline(input: { onTimeout: () => void }): RefactorTurnDeadline {
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let maxTimer: ReturnType<typeof setTimeout> | null = null

  const armIdleTimer = (): void => {
    if (idleTimer) {
      clearTimeout(idleTimer)
    }
    idleTimer = setTimeout(input.onTimeout, REFACTOR_TURN_IDLE_TIMEOUT_MS)
  }

  return {
    start(): void {
      maxTimer = setTimeout(input.onTimeout, REFACTOR_TURN_MAX_MS)
      armIdleTimer()
    },
    alive(): void {
      armIdleTimer()
    },
    stop(): void {
      if (idleTimer) {
        clearTimeout(idleTimer)
        idleTimer = null
      }
      if (maxTimer) {
        clearTimeout(maxTimer)
        maxTimer = null
      }
    }
  }
}
