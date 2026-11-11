// Builds the macOS Intel (x64) slice of the desktop app for local use.
//
// Run from the repository root: `node config/scripts/desktop-distribution/macos/build-mac-x64-local.mjs`.
// electron-builder downloads the Electron runtime and its own toolset, so a proxy is often
// required; set ORCA_BUILD_PROXY (or the standard HTTPS_PROXY/HTTP_PROXY) to point at one.
//
// ORCA_SKIP_ELECTRON_CHECKSUM_DOWNLOAD=1 drops @electron/get's SHASUMS256.txt re-download,
// which is the request a filtering proxy most often refuses. The Electron zip's checksum
// verification stays on for every other path.
import { execFileSync } from 'node:child_process'
import { getLocalBuildIdentity } from './build-mac-local.mjs'

const identity = getLocalBuildIdentity()
console.log(`[build:mac:x64] local update version ${identity.version}`)

const proxy =
  process.env.ORCA_BUILD_PROXY ?? process.env.HTTPS_PROXY ?? process.env.https_proxy ?? null
const env = {
  ...process.env,
  ORCA_BUILD_COMMIT: identity.commit,
  ORCA_LOCAL_BUILD_VERSION: identity.version
}

if (proxy) {
  env.HTTP_PROXY = proxy
  env.HTTPS_PROXY = proxy
  env.http_proxy = proxy
  env.https_proxy = proxy
  env.NO_PROXY = env.NO_PROXY ?? 'localhost,127.0.0.1,::1'
  env.no_proxy = env.no_proxy ?? 'localhost,127.0.0.1,::1'
  // @electron/get routes undici through the proxy only when asked to.
  env.ELECTRON_GET_USE_PROXY = 'true'
  // @electron/get v3 bootstraps global-agent from its own prefixed variables.
  env.GLOBAL_AGENT_HTTP_PROXY = proxy
  env.GLOBAL_AGENT_HTTPS_PROXY = proxy
  env.GLOBAL_AGENT_NO_PROXY = env.NO_PROXY
  console.log(`[build:mac:x64] using proxy ${proxy}`)
}

if (process.env.ORCA_SKIP_ELECTRON_CHECKSUM_DOWNLOAD === '1') {
  env.ORCA_SKIP_ELECTRON_CHECKSUM_DOWNLOAD = '1'
  console.log('[build:mac:x64] skipping the SHASUMS256.txt re-download')
}

execFileSync(
  'pnpm',
  [
    'exec',
    'electron-builder',
    '--config',
    'config/electron-builder-mac-x64.config.cjs',
    '--mac',
    '--x64'
  ],
  { env, stdio: 'inherit' }
)
