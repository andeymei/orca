import type { AuthDatabase } from './auth-database.js'
import { newIdentifier } from './auth-identity.js'
import { readOptionalString, readString } from './record-value.js'

export type AuthUser = {
  userId: string
  email: string
  displayName?: string
  passwordHash: string
}

function toAuthUser(row: Record<string, unknown> | undefined): AuthUser | null {
  if (!row) {
    return null
  }
  const displayName = readOptionalString(row, 'display_name')
  return {
    userId: readString(row, 'user_id'),
    email: readString(row, 'email'),
    ...(displayName === undefined ? {} : { displayName }),
    passwordHash: readString(row, 'password_hash')
  }
}

export async function findUserByEmail(
  database: AuthDatabase,
  email: string
): Promise<AuthUser | null> {
  const [row] = await database.query('SELECT * FROM auth_users WHERE email = ?', [email])
  return toAuthUser(row)
}

export async function findUserById(
  database: AuthDatabase,
  userId: string
): Promise<AuthUser | null> {
  const [row] = await database.query('SELECT * FROM auth_users WHERE user_id = ?', [userId])
  return toAuthUser(row)
}

export async function createUser(
  database: AuthDatabase,
  input: { email: string; passwordHash: string; displayName?: string }
): Promise<string> {
  const userId = newIdentifier('user')
  await database.query(
    'INSERT INTO auth_users (user_id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
    [userId, input.email, input.displayName ?? null, input.passwordHash, Date.now()]
  )
  return userId
}
