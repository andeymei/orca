const release = require('./electron-builder.config.cjs')

// Local Apple-silicon slice, mirroring config/electron-builder-mac-x64.config.cjs.
//
// The canonical config pins the mac targets to arch ['x64', 'arm64'], and an explicit
// per-target arch list wins over electron-builder's --arm64 flag, so the canonical config
// still attempts the Intel slice on an arm64 host that never installed the x64 optional
// dependencies. This variant keeps every canonical setting and narrows only the mac target
// arch to arm64.
module.exports = {
  ...release,
  mac: {
    ...release.mac,
    target: [
      { target: 'dmg', arch: ['arm64'] },
      { target: 'zip', arch: ['arm64'] }
    ]
  }
}
