/**
 * The platform a host's paths name.
 *
 * A paired host's own answer does not reach this machine, so the paths it uses are what says how
 * it runs: a Windows path names a drive, a macOS path names a volume.
 */
export function hostPlatformOf(cwd: string | null): NodeJS.Platform {
  if (!cwd) {
    return 'linux'
  }
  if (/^[A-Za-z]:[\\/]/.test(cwd)) {
    return 'win32'
  }
  return /^\/(Users|Volumes)\//.test(cwd) ? 'darwin' : 'linux'
}
