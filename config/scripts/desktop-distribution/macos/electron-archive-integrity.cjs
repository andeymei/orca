// Verifies a cached Electron archive against a pinned digest and stages the verified copy
// where electron-builder will consume it.
//
// @electron/get re-fetches the release's SHASUMS256.txt on every run (cacheMode: Bypass),
// so a build behind a filtering proxy can end up with the archive in its cache but no way
// to re-verify it. Pinning the digest lets the build check the archive itself without that
// fetch. Every failure path throws: a missing pin or a digest mismatch must stop the build
// rather than fall back to trusting the file.
//
// The verified archive is copied into a build-owned cache root at the path @electron/get
// looks in, so the bytes electron-builder consumes are the bytes that were hashed here.
const { createHash } = require('node:crypto')
const {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync
} = require('node:fs')
const { homedir } = require('node:os')
const { dirname, join } = require('node:path')

// Digests published by the Electron release's SHASUMS256.txt, pinned per archive.
// Add an entry when the Electron version changes; a missing entry fails the build.
const PINNED_ELECTRON_ARCHIVE_SHA256 = {
  '43.8.6-darwin-x64': 'c12e82216da91117623165c8f9f6c8175cb7f9940d01da2cbbd5c6696dcf0b45'
}

const ELECTRON_RELEASE_BASE_URL = 'https://github.com/electron/electron/releases/download'

function findArchives(root, archiveName, depth = 3) {
  if (!existsSync(root) || depth < 0) {
    return []
  }
  const found = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name)
    if (entry.isDirectory()) {
      found.push(...findArchives(entryPath, archiveName, depth - 1))
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
    const [match] = findArchives(root, archiveName)
    if (match) {
      return match
    }
  }
  return null
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

// @electron/get keys its cache by the artifact URL with the file name dropped, hashed with
// sha256. Reproduce that layout so a staged archive is found under the name it expects.
function electronCacheDirectory(artifactUrl) {
  const url = new URL(artifactUrl)
  const stripped = `${url.protocol}//${url.host}${dirname(url.pathname)}`
  return createHash('sha256').update(stripped).digest('hex')
}

/**
 * Verify the cached Electron archive against its pinned digest and stage the verified copy.
 *
 * @param {{ version: string, platform: string, arch: string, stagingRoot: string }} options
 * @returns {{ archivePath: string, cacheRoot: string }} the staged archive and the cache root
 *   electron-builder must read it from
 */
function verifyAndStageElectronArchive({ version, platform, arch, stagingRoot }) {
  if (!version) {
    throw new Error('The electron dependency is missing from package.json')
  }
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
  const sourcePath = resolveElectronArchive(archiveName)
  if (!sourcePath) {
    throw new Error(
      `No cached ${archiveName} to verify. Run once without ORCA_SKIP_ELECTRON_CHECKSUM_DOWNLOAD ` +
        'so electron-builder downloads and verifies it, then retry with the skip.'
    )
  }
  const sourceDigest = sha256File(sourcePath)
  if (sourceDigest !== expected) {
    throw new Error(
      `The cached ${archiveName} does not match the pinned digest (expected ${expected}, got ` +
        `${sourceDigest}). Refusing to build from an unverified Electron archive.`
    )
  }

  const artifactUrl = `${ELECTRON_RELEASE_BASE_URL}/v${version}/${archiveName}`
  const cacheDirectory = join(stagingRoot, electronCacheDirectory(artifactUrl))
  mkdirSync(cacheDirectory, { recursive: true })
  const stagedPath = join(cacheDirectory, archiveName)
  // A previous run may have left the staged copy read-only.
  if (existsSync(stagedPath)) {
    chmodSync(stagedPath, 0o644)
  }
  copyFileSync(sourcePath, stagedPath)

  // Re-hash the staged copy: the guarantee has to cover the bytes electron-builder reads.
  const stagedDigest = sha256File(stagedPath)
  if (stagedDigest !== expected) {
    throw new Error(
      `The staged ${archiveName} does not match the pinned digest (expected ${expected}, got ` +
        `${stagedDigest}). Refusing to build from an unverified Electron archive.`
    )
  }
  // Read-only so nothing can change the bytes between this check and the packaging run.
  chmodSync(stagedPath, 0o444)
  return { archivePath: stagedPath, cacheRoot: stagingRoot }
}

module.exports = { PINNED_ELECTRON_ARCHIVE_SHA256, verifyAndStageElectronArchive }
