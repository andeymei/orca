const release = require('./electron-builder.config.cjs')

// The canonical config pins the mac targets to `arch: ['x64', 'arm64']`, and an explicit
// per-target arch list wins over electron-builder's `--x64` flag — so `electron-builder
// --mac --x64` still attempts the arm64 slice and fails on hosts that never installed the
// arm64 optional dependencies. This variant keeps every canonical setting and narrows only
// the mac target arch to Intel.
//
// `ORCA_ELECTRON_ARCHIVE_VERIFIED` is set by build-mac-x64-local.mjs only after it checked
// the cached Electron archive against a pinned digest. @electron/get re-fetches
// SHASUMS256.txt on every run (cacheMode: Bypass), and that file — not the archive — is what
// a filtering proxy usually drops. Skipping the re-fetch is therefore only safe once the
// archive itself has been verified; the flag alone cannot disable verification.
module.exports = {
  ...release,
  electronDownload: {
    ...release.electronDownload,
    ...(process.env.ORCA_ELECTRON_ARCHIVE_VERIFIED === '1' ? { isVerifyChecksum: false } : {})
  },
  mac: {
    ...release.mac,
    target: [
      { target: 'dmg', arch: ['x64'] },
      { target: 'zip', arch: ['x64'] }
    ]
  }
}
