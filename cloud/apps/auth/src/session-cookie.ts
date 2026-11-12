import { createHmac, timingSafeEqual } from 'node:crypto'

const COOKIE_NAME = 'orca_auth_login'

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

export function createLoginCookieValue(userId: string, secret: string): string {
  return Buffer.from(`${userId}.${sign(userId, secret)}`, 'utf8').toString('base64url')
}

export function readLoginCookieValue(
  cookieHeader: string | undefined,
  secret: string
): string | null {
  if (cookieHeader === undefined) {
    return null
  }
  const entry = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
  if (entry === undefined) {
    return null
  }
  const raw = entry.slice(COOKIE_NAME.length + 1)
  let decoded: string
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8')
  } catch {
    return null
  }
  const separator = decoded.lastIndexOf('.')
  if (separator <= 0) {
    return null
  }
  const userId = decoded.slice(0, separator)
  const signature = decoded.slice(separator + 1)
  const expected = sign(userId, secret)
  const given = Buffer.from(signature, 'utf8')
  const wanted = Buffer.from(expected, 'utf8')
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return null
  }
  return userId
}

export function loginCookieHeader(
  userId: string,
  secret: string,
  maxAgeSeconds: number,
  secure: boolean
): string {
  const value = createLoginCookieValue(userId, secret)
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${
    secure ? '; Secure' : ''
  }`
}

export function clearedLoginCookieHeader(secure: boolean): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`
}
