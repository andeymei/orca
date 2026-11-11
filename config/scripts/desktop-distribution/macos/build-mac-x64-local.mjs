// Builds the macOS Intel (x64) slice of the desktop app for local use.
//
// Run from the repository root: `node config/scripts/desktop-distribution/macos/build-mac-x64-local.mjs`.
// electron-builder downloads the Electron runtime and its own toolset, so a proxy is often
// required; set ORCA_BUILD_PROXY (or the standard HTTPS_PROXY/HTTP_PROXY) to point at one.
//
// ORCA_SKIP_ELECTRON_CHECKSUM_DOWNLOAD=1 drops @electron/get's SHASUMS256.txt re-download,
// which is the request a filtering proxy most often refuses. It never disables verification
// on its own: the cached archive is first checked against a pinned digest, and the build
// fails closed when that digest is missing or does not match.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { getLocalBuildIdentity } from './build-mac-local.mjs'

// Digests published by the Electron release's SHASUMS256.txt, pinned per archive so a
// cached download can be verified without re-fetching that file. Add an entry when the
// Electron version changes; a missing entry makes the skip refuse to run.
const PINNED_ELECTRON_ARCHIVE_SHA256 = {
  '43.8.6-darwin-x64': 'c12e82216da91117623165c8f9f6c8175cb7f9940d01da2cbbd5c6696dcf0b45'
}

const identity = getLocalBuildIdentity()
console.log(`[build:mac:x64] local update version ${identity.version}`)

function redactProxy(proxyUrl) {
  try {
    const url = new URL(proxyUrl)
    return `${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`
  } catch {
    return '<unparsable proxy url>'
  }
}

function findElectronArchives(root, archiveName, depth = 3) {
  if (!existsSync(root) || depth < 0) {
    return []
  }
  const found = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name)
    if (entry.isDirectory()) {
      found.push(...findElectronArchives(entryPath, archiveName, depth - 1))
    } else if (entry.name === archiveName) {
      found.push(entryPath)
    }
  }
  return found
}

function resolveElectronArchive(archiveName) {
  const home = homedir()
  const roots = [
    join(home, 'Library', 'Caches', 'electron'),
    join(home, 'Library', 'Caches', 'electron-builder', 'downloads'),
    process.env.ELECTRON_BUILDER_CACHE
      ? join(process.env.ELECTRON_BUILDER_CACHE, 'downloads')
      : null
  ].filter(Boolean)
  for (const root of roots) {
    const [match] = findElectronArchives(root, archiveName)
    if (match) {
      return match
    }
  }
  return null
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

// @electron/get always re-fetches SHASUMS256.txt (cacheMode: Bypass), and that request —
// not the archive — is what a filtering proxy drops. Verify the cached archive against a
// pinned digest instead, and only then let the packager skip the doomed checksum fetch.
function verifyCachedElectronArchive() {
  const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
  const version = packageJson.devDependencies?.electron ?? packageJson.dependencies?.electron
  if (!version) {
    throw new Error('The electron dependency is missing from package.json')
  }
  const platform = 'darwin'
  const arch = 'x64'
  const key = `${version}-${platform}-${arch}`
  const expected = PINNED_ELECTRON_ARCHIVE_SHA256[key]
  if (!expected) {
    throw new Error(
      `No pinned Electron archive digest for ${key}. Add it to PINNED_ELECTRON_ARCHIVE_SHA256 ` +
        'after reading the value from the Electron release SHASUMS256.txt, or build without ' +
        'ORCA_SKIP_ELECTRON_CHECKSUM_DOWNLOAD so the download is verified in place.'
    )
  }
  const archiveName = `electron-v${version}-${platform}-${arch}.zip`
  const archivePath = resolveElectronArchive(archiveName)
  if (!archivePath) {
    throw new Error(
      `No cached ${archiveName} to verify. Run once without ORCA_SKIP_ELECTRON_CHECKSUM_DOWNLOAD ` +
        'so electron-builder downloads and verifies it, then retry with the skip.'
    )
  }
  const actual = sha256File(archivePath)
  if (actual !== expected) {
    throw new Error(
      `The cached ${archiveName} does not match the pinned digest (expected ${expected}, got ${actual}). ` +
        'Refusing to build from an unverified Electron archive.'
    )
  }
  console.log(`[build:mac:x64] verified cached ${archiveName} against its pinned digest`)
}

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
  console.log(`[build:mac:x64] using proxy ${redactProxy(proxy)}`)
}

if (process.env.ORCA_SKIP_ELECTRON_CHECKSUM_DOWNLOAD === '1') {
  verifyCachedElectronArchive()
  // The builder config only skips the checksum download once the archive has been verified.
  env.ORCA_ELECTRON_ARCHIVE_VERIFIED = '1'
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
