/** Fresh isolated HOME lacks macOS login-keychain OSCrypt keys, so Chromium can block main/readiness on an unanswered authorization prompt (#25453). Apply matching switches to sidecar and CLI-launched foreground serve. */
export function usesIsolatedProfile(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ORCA_E2E_USER_DATA_DIR || env.ORCA_E2E_HOME_DIR)
}

const ISOLATED_PROFILE_SWITCHES = ['--password-store=basic', '--use-mock-keychain']

/**
 * Chromium reads these switches at startup, so every launcher of an isolated profile must pass
 * them: an isolated HOME has no macOS login keychain, and the app would otherwise ask the system
 * keychain UI where to store "orca Key" and block on that dialog.
 */
export function electronIsolatedKeychainArgs(
  platform: NodeJS.Platform = process.platform
): string[] {
  return platform === 'darwin' ? [...ISOLATED_PROFILE_SWITCHES] : []
}

export function electronIsolatedProfileSwitches(env: NodeJS.ProcessEnv = process.env): string[] {
  return usesIsolatedProfile(env) ? [...ISOLATED_PROFILE_SWITCHES] : []
}

/** Foreground serve reads selected-profile secrets: only USER_DATA_DIR isolates those. HOME alone must not switch the real profile to plaintext storage. */
export function foregroundServeIsolatedProfileSwitches(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  return env.ORCA_E2E_USER_DATA_DIR ? [...ISOLATED_PROFILE_SWITCHES] : []
}
