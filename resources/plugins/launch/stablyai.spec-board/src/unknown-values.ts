// The values that reach the board as `unknown`: a JSON value read out of a file, and a failure the
// filesystem reported. The board states facts, so it has to say which one it is holding — a type
// guard says it without a cast.

/** Whether a value read out of JSON is an object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The code a failure carries, when it has one: an errno for a file, a code for a refusal. */
export function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined
  }
  return typeof error.code === 'string' ? error.code : undefined
}
