// Builds the macOS Intel (x64) slice of the desktop app for local use.
//
// Run from the repository root: `node config/scripts/desktop-distribution/macos/build-mac-x64-local.mjs`.
// electron-builder downloads the Electron runtime and its own toolset, so a proxy is often
// required; set ORCA_BUILD_PROXY (or the standard HTTPS_PROXY/HTTP_PROXY) to point at one.
//
// ORCA_SKIP_ELECTRON_CHECKSUM_DOWNLOAD=1 asks the builder config to skip @electron/get's
// SHASUMS256.txt re-download, which is the request a filtering proxy most often refuses.
// The config verifies the cached archive against a pinned digest itself, in the same process
// that consumes it, and refuses to build when that check fails — this driver never asserts
// that verification happened.
import { execFileSync } from 'node:child_process'
import { getLocalBuildIdentity } from './build-mac-local.mjs'
import { localBuilderEnv, redactProxy } from './local-builder-env.mjs'

const identity = getLocalBuildIdentity()
console.log(`[build:mac:x64] local update version ${identity.version}`)

const { env, proxy } = localBuilderEnv(process.env)
env.ORCA_BUILD_COMMIT = identity.commit
env.ORCA_LOCAL_BUILD_VERSION = identity.version

if (proxy) {
  console.log(`[build:mac:x64] using proxy ${redactProxy(proxy)}`)
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
