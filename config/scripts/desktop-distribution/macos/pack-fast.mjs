#!/usr/bin/env node
// The local package → install → verify loop.
//
// `pnpm build:mac` is the release-shaped path: a full typecheck, both architectures, signed
// and notarized artifacts. This driver is the iteration loop. It skips the typecheck,
// packages the app directory only, installs it over the copy in /Applications, and checks
// that the installed app starts.
//
// The gates that matter are not skipped. The builder's own beforePack/afterPack checks still
// run during packaging — asar integrity, the web-client manifest, the packaged CLI, the
// daemon entry, the native helpers — and the verify stage drives the installed app.
//
// Usage:
//   node config/scripts/desktop-distribution/macos/pack-fast.mjs [build|install|verify] [options]
//
// Options:
//   --typecheck   run the full typecheck before packaging (off by default)
//   --dmg         also produce a DMG instead of the app directory alone
//   --launch      relaunch the app after installing it
//   --full        verify with the complete packaged smoke suite instead of the startup check
//   --source <p>  the built app to install (default dist/mac/Orca.app)
//   --target <p>  the app to install over (default /Applications/Orca.app)
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { getLocalBuildIdentity } from './build-mac-local.mjs'
import { localBuilderEnv, redactProxy } from './local-builder-env.mjs'
import { DEFAULT_INSTALL_TARGET, installMacApp } from './mac-app-install.mjs'

const STAGES = ['build', 'install', 'verify']
const DEFAULT_SOURCE_APP = 'dist/mac/Orca.app'

/**
 * Refuse to package while another packager is running in this checkout.
 *
 * Two packagers write the same `out/` and the same `dist/mac/Orca.app`, and each one ends up
 * shipping the other's half-written bundle. The asar integrity check catches some of it, but
 * a package built from a bundle another builder was rewriting is not worth shipping.
 */
export function assertNoConcurrentPackaging(runner = spawnSync) {
  const result = runner('pgrep', ['-f', 'electron-builder/cli.js'], { encoding: 'utf8' })
  if (result.status === 0) {
    throw new Error(
      'Another electron-builder run is packaging this checkout. Wait for it to finish, or ' +
        'package in a separate checkout: two packagers write the same out/ and dist/mac/Orca.app.'
    )
  }
}

// The assets a package needs. `build:desktop` adds a typecheck and the WSL guest build on
// top; the WSL guest relay is needed because the packaged app ships it as a resource.
const ASSET_STEPS = [
  ['workspace packages', ['run', 'build:packages']],
  ['electron runtime', ['run', 'ensure:electron-runtime']],
  ['mac native helpers', ['run', 'build:native']],
  ['wsl guest relay', ['run', 'build:wsl-guest']],
  ['cli', ['run', 'build:cli']],
  ['electron bundles', ['run', 'build:electron-vite']],
  ['web client', ['run', 'build:web-from-renderer']],
  ['mobile web', ['run', 'build:mobile-web']]
]

function parseOptions(argv) {
  const readOption = (name, fallback) => {
    const index = argv.indexOf(name)
    return index !== -1 && argv[index + 1] ? argv[index + 1] : fallback
  }
  // An option value can spell a stage name, so a stage is only a stage when it is not
  // sitting in the value slot of an option.
  const optionValues = new Set(
    ['--source', '--target'].map((name) => readOption(name, null)).filter((value) => value !== null)
  )
  const stage = argv.find((argument) => STAGES.includes(argument) && !optionValues.has(argument))
  return {
    stage: stage ?? 'all',
    typecheck: argv.includes('--typecheck'),
    dmg: argv.includes('--dmg'),
    launch: argv.includes('--launch'),
    full: argv.includes('--full'),
    sourceApp: resolve(readOption('--source', DEFAULT_SOURCE_APP)),
    targetApp: resolve(readOption('--target', DEFAULT_INSTALL_TARGET))
  }
}

function runStep(label, action) {
  const startedAt = Date.now()
  console.log(`\n[pack:fast] ${label} …`)
  action()
  console.log(`[pack:fast] ${label} done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
}

function runPnpmScript(label, scriptArgs) {
  runStep(label, () => {
    execFileSync('pnpm', scriptArgs, { stdio: 'inherit' })
  })
}

function packageApp({ dmg }) {
  assertNoConcurrentPackaging()
  const identity = getLocalBuildIdentity()
  const { env, proxy } = localBuilderEnv(process.env)
  env.ORCA_BUILD_COMMIT = identity.commit
  env.ORCA_LOCAL_BUILD_VERSION = identity.version
  // The target slice is this machine's own architecture on a local build, so the native
  // runtime that is already built for Electron is the one the package needs.
  env.ORCA_REUSE_PREPARED_NATIVE_RUNTIME = '1'
  if (proxy) {
    // @electron/get re-fetches the release's SHASUMS256.txt on every run, and that request
    // is the one a filtering proxy drops. The builder config verifies the cached archive
    // against a pinned digest in the same process that consumes it, so the skip is safe.
    env.ORCA_SKIP_ELECTRON_CHECKSUM_DOWNLOAD = '1'
    console.log(`[pack:fast] using proxy ${redactProxy(proxy)}`)
  }
  const builderArgs = [
    'exec',
    'electron-builder',
    '--config',
    'config/electron-builder-mac-x64.config.cjs',
    '--mac',
    '--x64'
  ]
  if (!dmg) {
    // The app directory alone skips the DMG, the 260 MB ZIP and the update manifests.
    builderArgs.push('--dir')
  }
  runStep(dmg ? 'package (dmg)' : 'package (app directory)', () => {
    execFileSync('pnpm', builderArgs, { env, stdio: 'inherit' })
  })
  console.log(`[pack:fast] local update version ${identity.version}`)
}

function runBuild(options) {
  if (options.typecheck) {
    runPnpmScript('typecheck', ['run', 'typecheck'])
  }
  for (const [label, scriptArgs] of ASSET_STEPS) {
    runPnpmScript(label, scriptArgs)
  }
  packageApp(options)
}

function runInstall(options) {
  runStep('install', () => {
    installMacApp({ sourceApp: options.sourceApp, targetApp: options.targetApp })
    if (options.launch) {
      execFileSync('open', ['-g', '-a', options.targetApp])
      console.log(`[pack:fast] relaunched ${options.targetApp}`)
    }
  })
}

function runVerify(options) {
  const appPath = existsSync(options.targetApp) ? options.targetApp : options.sourceApp
  const smokeArgs = ['config/scripts/runtime-verification/macos/packaged-app-smoke.mjs', appPath]
  if (!options.full) {
    smokeArgs.push('--quick')
  }
  runStep(options.full ? 'verify (full smoke)' : 'verify (startup check)', () => {
    execFileSync(process.execPath, smokeArgs, { stdio: 'inherit' })
  })
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const options = parseOptions(process.argv.slice(2))
  const stages = options.stage === 'all' ? STAGES : [options.stage]
  for (const stage of stages) {
    if (stage === 'build') {
      runBuild(options)
    } else if (stage === 'install') {
      runInstall(options)
    } else {
      runVerify(options)
    }
  }
}
