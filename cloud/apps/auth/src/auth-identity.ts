import { createHash, randomBytes, randomUUID } from 'node:crypto'

export function newSecret(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url')
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url')
}

export function newIdentifier(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`
}

/** The desktop derives the relay host id from the raw public key bytes; the relay matches the claim. */
export function deriveRelayHostId(hostPublicKey: Uint8Array): string {
  return createHash('sha256').update(hostPublicKey).digest('base64url').slice(0, 16)
}

export function decodeHostPublicKey(value: string): Uint8Array | null {
  const decoded = Buffer.from(value, 'base64')
  return decoded.length === 32 ? new Uint8Array(decoded) : null
}
