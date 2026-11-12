import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error)
        return
      }
      resolve(derivedKey)
    })
  })
}

const ALGORITHM = 'scrypt'
const KEY_LENGTH = 64
const COST = 16384
const BLOCK_SIZE = 8
const PARALLELIZATION = 1

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await deriveKey(password, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION
  })
  return [
    ALGORITHM,
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString('base64url'),
    derived.toString('base64url')
  ].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== ALGORITHM) {
    return false
  }
  const cost = Number(parts[1])
  const blockSize = Number(parts[2])
  const parallelization = Number(parts[3])
  if (!Number.isInteger(cost) || !Number.isInteger(blockSize) || !Number.isInteger(parallelization)) {
    return false
  }
  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(parts[4] ?? '', 'base64url')
    expected = Buffer.from(parts[5] ?? '', 'base64url')
  } catch {
    return false
  }
  if (salt.length === 0 || expected.length === 0) {
    return false
  }
  let derived: Buffer
  try {
    derived = await deriveKey(password, salt, expected.length, {
      N: cost,
      r: blockSize,
      p: parallelization
    })
  } catch {
    return false
  }
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}
