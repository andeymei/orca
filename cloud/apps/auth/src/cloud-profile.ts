import type { AuthDatabase } from './auth-database.js'
import { newIdentifier } from './auth-identity.js'
import { readNumber, readOptionalString, readString } from './record-value.js'

export type CloudProfileSummary = {
  cloudProfileId: string
  userId: string
  email: string
  displayName?: string
  activeOrgId?: string
  activeOrgName?: string
  linkedAt: number
}

export type OrganizationSummary = {
  orgId: string
  name: string
  role?: string
}

export async function describeCloudProfile(
  database: AuthDatabase,
  cloudProfileId: string
): Promise<CloudProfileSummary | null> {
  const [row] = await database.query(
    `SELECT cloud_profile.cloud_profile_id, cloud_profile.user_id, cloud_profile.display_name,
            cloud_profile.active_org_id, cloud_profile.created_at, account.email
       FROM auth_cloud_profiles cloud_profile
       JOIN auth_users account ON account.user_id = cloud_profile.user_id
      WHERE cloud_profile.cloud_profile_id = ?`,
    [cloudProfileId]
  )
  if (!row) {
    return null
  }
  const activeOrgId = readOptionalString(row, 'active_org_id')
  const activeOrgName = activeOrgId
    ? await readOrganizationName(database, activeOrgId)
    : undefined
  const displayName = readOptionalString(row, 'display_name')
  return {
    cloudProfileId: readString(row, 'cloud_profile_id'),
    userId: readString(row, 'user_id'),
    email: readString(row, 'email'),
    ...(displayName === undefined ? {} : { displayName }),
    ...(activeOrgId === undefined ? {} : { activeOrgId }),
    ...(activeOrgName === undefined ? {} : { activeOrgName }),
    linkedAt: readNumber(row, 'created_at')
  }
}

export async function listOrganizations(
  database: AuthDatabase,
  userId: string
): Promise<OrganizationSummary[]> {
  const rows = await database.query(
    `SELECT org.org_id, org.name, membership.role
       FROM auth_memberships membership
       JOIN auth_organizations org ON org.org_id = membership.org_id
      WHERE membership.user_id = ?
      ORDER BY org.name ASC`,
    [userId]
  )
  return rows.map((row) => ({
    orgId: readString(row, 'org_id'),
    name: readString(row, 'name'),
    role: readOptionalString(row, 'role')
  }))
}

export async function createCloudProfile(
  database: AuthDatabase,
  input: { userId: string; displayName?: string; activeOrgId?: string }
): Promise<string> {
  const cloudProfileId = newIdentifier('profile')
  await database.query(
    `INSERT INTO auth_cloud_profiles
       (cloud_profile_id, user_id, display_name, active_org_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      cloudProfileId,
      input.userId,
      input.displayName ?? null,
      input.activeOrgId ?? null,
      Date.now()
    ]
  )
  return cloudProfileId
}

/** A sign-in must not mint a new cloud profile every time; the desktop links the local profile to it. */
export async function findOrCreateCloudProfile(
  database: AuthDatabase,
  input: { userId: string; displayName?: string; activeOrgId?: string }
): Promise<string> {
  const [row] = await database.query(
    'SELECT cloud_profile_id FROM auth_cloud_profiles WHERE user_id = ? ORDER BY created_at ASC LIMIT 1',
    [input.userId]
  )
  if (row) {
    return readString(row, 'cloud_profile_id')
  }
  return await createCloudProfile(database, input)
}

export async function setActiveOrganization(
  database: AuthDatabase,
  cloudProfileId: string,
  orgId: string
): Promise<void> {
  await database.query('UPDATE auth_cloud_profiles SET active_org_id = ? WHERE cloud_profile_id = ?', [
    orgId,
    cloudProfileId
  ])
}

/** Every account needs one organization, because the relay token carries an organization claim. */
export async function ensurePersonalOrganization(
  database: AuthDatabase,
  userId: string
): Promise<string> {
  const existing = await listOrganizations(database, userId)
  const first = existing[0]
  if (first) {
    return first.orgId
  }
  const orgId = newIdentifier('org')
  await database.query(
    'INSERT INTO auth_organizations (org_id, name, created_at) VALUES (?, ?, ?)',
    [orgId, 'Personal', Date.now()]
  )
  await database.query(
    'INSERT INTO auth_memberships (org_id, user_id, role) VALUES (?, ?, ?)',
    [orgId, userId, 'owner']
  )
  return orgId
}

async function readOrganizationName(database: AuthDatabase, orgId: string): Promise<string | undefined> {
  const [row] = await database.query('SELECT name FROM auth_organizations WHERE org_id = ?', [orgId])
  return row ? readOptionalString(row, 'name') : undefined
}
