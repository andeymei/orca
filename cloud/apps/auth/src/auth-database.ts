import {
  openCloudDatabase,
  openInMemoryCloudDatabase,
  type CloudDatabase,
  type OpenCloudDatabaseInput
} from '@orca-cloud/cloud-database'
import { authSchemaStatements } from './auth-schema.js'

export type AuthDatabase = CloudDatabase
export type { SqlRow } from '@orca-cloud/cloud-database'

export async function openAuthDatabase(
  input: Omit<OpenCloudDatabaseInput, 'service' | 'schemaStatements'>
): Promise<AuthDatabase> {
  return await openCloudDatabase({ ...input, service: 'auth', schemaStatements: authSchemaStatements() })
}

export async function openInMemoryAuthDatabase(): Promise<AuthDatabase> {
  return await openInMemoryCloudDatabase(authSchemaStatements())
}
