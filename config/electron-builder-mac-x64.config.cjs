const { homedir } = require('node:os')
const { join } = require('node:path')
const release = require('./electron-builder.config.cjs')
const {
  verifyAndStageElectronArchive
} = require('./scripts/desktop-distribution/macos/electron-archive-integrity.cjs')

// The canonical config pins the mac targets to `arch: ['x64', 'arm64']`, and an explicit
// per-target arch list wins over electron-builder's `--x64` flag — so `electron-builder
// --mac --x64` still attempts the arm64 slice and fails on hosts that never installed the
// arm64 optional dependencies. This variant keeps every canonical setting and narrows only
// the mac target arch to Intel.
//
// @electron/get re-fetches the release's SHASUMS256.txt on every run (cacheMode: Bypass),
// and that request — not the archive — is what a filtering proxy usually drops. Skipping it
// is only safe once the archive itself is verified, so the verification runs here, in the
// same process that goes on to consume the archive, and fails closed on every error path.
// The environment variable only asks for the skip; it cannot assert that it happened.
//
// The verified archive is staged into a cache root this build owns and electron-builder
// reads it from there, so the bytes it consumes are the bytes that were hashed against the
// pin. The root sits outside the repository because `out/` is not excluded from app.asar.
const skipChecksumDownload = process.env.ORCA_SKIP_ELECTRON_CHECKSUM_DOWNLOAD === '1'
let stagedArchive
if (skipChecksumDownload) {
  const packageJson = require('../package.json')
  const version = packageJson.devDependencies?.electron ?? packageJson.dependencies?.electron
  stagedArchive = verifyAndStageElectronArchive({
    version,
    platform: 'darwin',
    arch: 'x64',
    stagingRoot: join(homedir(), '.cache', 'orca', 'electron-archive')
  })
  console.log(
    `[electron-builder-mac-x64] verified ${stagedArchive.archivePath} against its pinned digest`
  )
}

module.exports = {
  ...release,
  electronDownload: {
    ...release.electronDownload,
    ...(skipChecksumDownload ? { isVerifyChecksum: false, cache: stagedArchive.cacheRoot } : {})
  },
  mac: {
    ...release.mac,
    target: [
      { target: 'dmg', arch: ['x64'] },
      { target: 'zip', arch: ['x64'] }
    ]
  }
}
