import type { SqlRow } from './auth-database.js'

export function readString(row: SqlRow | undefined, key: string): string {
  const value = row?.[key]
  if (typeof value !== 'string') {
    throw new Error(`orca_auth_record_missing_${key}`)
  }
  return value
}

export function readOptionalString(row: SqlRow | undefined, key: string): string | undefined {
  const value = row?.[key]
  if (typeof value !== 'string' || value.length === 0) {
    return undefined
  }
  return value
}

export function readNumber(row: SqlRow | undefined, key: string): number {
  const value = row?.[key]
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  throw new Error(`orca_auth_record_missing_${key}`)
}

export function readOptionalNumber(row: SqlRow | undefined, key: string): number | undefined {
  const value = row?.[key]
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}
