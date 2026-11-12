// Applied at startup for both dialects, so every column type has to read the same in SQLite and PostgreSQL.
const AUTH_SCHEMA = `
CREATE TABLE IF NOT EXISTS auth_users (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email ON auth_users(email);

CREATE TABLE IF NOT EXISTS auth_organizations (
  org_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_memberships (
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS auth_cloud_profiles (
  cloud_profile_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  display_name TEXT,
  active_org_id TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_cloud_profiles_user ON auth_cloud_profiles(user_id);

CREATE TABLE IF NOT EXISTS auth_authorization_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  nonce TEXT NOT NULL,
  state TEXT NOT NULL,
  local_profile_id TEXT,
  user_id TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  consumed_at BIGINT
);
CREATE INDEX IF NOT EXISTS auth_authorization_codes_expires_at ON auth_authorization_codes(expires_at);

CREATE TABLE IF NOT EXISTS auth_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  cloud_profile_id TEXT NOT NULL,
  refresh_generation BIGINT NOT NULL,
  previous_refresh_valid_until BIGINT,
  refresh_expires_at BIGINT NOT NULL,
  revoked_at BIGINT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_at ON auth_sessions(refresh_expires_at);
`

export function authSchemaStatements(): string[] {
  // Comments are stripped before the split so a ';' inside one cannot cut a statement in half.
  return AUTH_SCHEMA.replace(/--[^\n]*/g, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
}
