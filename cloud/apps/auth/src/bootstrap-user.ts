import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AuthDatabase } from './auth-database.js'
import { createUser, findUserByEmail } from './auth-user.js'
import { newSecret } from './auth-identity.js'
import { createCloudProfile, ensurePersonalOrganization } from './cloud-profile.js'
import type { AuthConfig } from './config.js'
import { hashPassword } from './password-hash.js'

/**
 * Seeds the first account. The generated password lands in a 0600 file instead of a log line,
 * because logs are shipped and read by people who should not hold the credential.
 */
export async function ensureBootstrapUser(
  database: AuthDatabase,
  config: AuthConfig
): Promise<void> {
  if (config.bootstrapUserEmail === undefined) {
    return
  }
  const email = config.bootstrapUserEmail.trim().toLowerCase()
  const existing = await findUserByEmail(database, email)
  if (existing) {
    return
  }
  const generated = config.bootstrapUserPassword === undefined
  const password = config.bootstrapUserPassword ?? newSecret(18)
  const userId = await createUser(database, {
    email,
    passwordHash: await hashPassword(password)
  })
  const orgId = await ensurePersonalOrganization(database, userId)
  await createCloudProfile(database, { userId, activeOrgId: orgId })
  if (generated) {
    const credentialsPath = join(config.dataDir, 'orca-auth-bootstrap-credentials.json')
    mkdirSync(dirname(credentialsPath), { recursive: true })
    writeFileSync(credentialsPath, `${JSON.stringify({ email, password }, null, 2)}\n`, {
      mode: 0o600
    })
    chmodSync(credentialsPath, 0o600)
    console.log(
      JSON.stringify({ event: 'orca_auth_bootstrap_user_created', email, credentialsPath })
    )
  }
}
