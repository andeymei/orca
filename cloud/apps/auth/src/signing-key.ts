import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject
} from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { exportJWK, type JWK } from 'jose'

export type SigningKey = {
  kid: string
  privateKey: KeyObject
  publicKey: KeyObject
  publicJwk: JWK
}

function deriveKeyId(publicKey: KeyObject): string {
  const spki = publicKey.export({ type: 'spki', format: 'der' })
  return createHash('sha256').update(spki).digest('base64url').slice(0, 16)
}

async function toSigningKey(privateKey: KeyObject): Promise<SigningKey> {
  const publicKey = createPublicKey(privateKey)
  const jwk = await exportJWK(publicKey)
  const kid = deriveKeyId(publicKey)
  return {
    kid,
    privateKey,
    publicKey,
    publicJwk: { ...jwk, kid, alg: 'ES256', use: 'sig' }
  }
}

export async function loadSigningKey(input: {
  pem?: string
  path: string
}): Promise<SigningKey> {
  if (input.pem !== undefined && input.pem.trim().length > 0) {
    return await toSigningKey(createPrivateKey(input.pem))
  }
  let pem: string
  try {
    pem = readFileSync(input.path, 'utf8')
  } catch {
    pem = generateSigningKeyPem()
    mkdirSync(dirname(input.path), { recursive: true })
    writeFileSync(input.path, pem, { mode: 0o600 })
    // The generated key must stay readable by this process only.
    chmodSync(input.path, 0o600)
  }
  return await toSigningKey(createPrivateKey(pem))
}

function generateSigningKeyPem(): string {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
}

export function jwksDocument(key: SigningKey): { keys: JWK[] } {
  return { keys: [key.publicJwk] }
}

export async function createEphemeralSigningKey(): Promise<SigningKey> {
  return await toSigningKey(createPrivateKey(generateSigningKeyPem()))
}
