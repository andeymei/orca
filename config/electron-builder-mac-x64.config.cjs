const release = require('./electron-builder.config.cjs')

// The canonical config pins the mac targets to `arch: ['x64', 'arm64']`, and an explicit
// per-target arch list wins over electron-builder's `--x64` flag — so `electron-builder
// --mac --x64` still attempts the arm64 slice and fails on hosts that never installed the
// arm64 optional dependencies. This variant keeps every canonical setting and narrows only
// the mac target arch to Intel.
//
// `ORCA_SKIP_ELECTRON_CHECKSUM_DOWNLOAD` is opt-in: @electron/get re-fetches SHASUMS256.txt
// on every run (cacheMode: Bypass), so that file — and not the Electron zip — is what a
// filtering proxy usually drops. Skipping it leaves the zip's own verification untouched
// whenever the zip is actually downloaded.
module.exports = {
  ...release,
  electronDownload: {
    ...release.electronDownload,
    ...(process.env.ORCA_SKIP_ELECTRON_CHECKSUM_DOWNLOAD === '1' ? { isVerifyChecksum: false } : {})
  },
  mac: {
    ...release.mac,
    target: [
      { target: 'dmg', arch: ['x64'] },
      { target: 'zip', arch: ['x64'] }
    ]
  }
}
