import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** A generated secret keeps a single-host deployment working without an operator-provided value. */
export function loadOrCreateSessionSecret(input: {
  provided?: string
  path: string
}): string {
  if (input.provided !== undefined && input.provided.length > 0) {
    return input.provided
  }
  try {
    const stored = readFileSync(input.path, 'utf8').trim()
    if (stored.length >= 32) {
      return stored
    }
  } catch {
    // Falls through to generating one.
  }
  const secret = randomBytes(48).toString('base64url')
  mkdirSync(dirname(input.path), { recursive: true })
  writeFileSync(input.path, secret, { mode: 0o600 })
  chmodSync(input.path, 0o600)
  return secret
}
