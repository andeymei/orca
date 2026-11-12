import { createHmac, timingSafeEqual } from 'node:crypto'

export type RefreshTokenParts = {
  sessionId: string
  generation: number
  mac: string
}

/**
 * A refresh token is derived, not random: the same generation always yields the same token, so a
 * replayed refresh inside the grace window can be answered with the token the client already
 * holds instead of a new one that would invalidate it.
 */
export function deriveRefreshToken(key: Uint8Array, sessionId: string, generation: number): string {
  const mac = createHmac('sha256', key).update(`${sessionId}.${generation}`).digest('base64url')
  return `${sessionId}.${generation}.${mac}`
}

export function parseRefreshToken(token: string): RefreshTokenParts | null {
  const parts = token.split('.')
  if (parts.length !== 3) {
    return null
  }
  const [sessionId, generationText, mac] = parts
  if (!sessionId || !generationText || !mac) {
    return null
  }
  const generation = Number(generationText)
  if (!Number.isInteger(generation) || generation < 1) {
    return null
  }
  return { sessionId, generation, mac }
}

export function refreshTokenMacMatches(
  key: Uint8Array,
  parts: RefreshTokenParts
): boolean {
  const expected = createHmac('sha256', key)
    .update(`${parts.sessionId}.${parts.generation}`)
    .digest('base64url')
  const given = Buffer.from(parts.mac, 'utf8')
  const wanted = Buffer.from(expected, 'utf8')
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}
