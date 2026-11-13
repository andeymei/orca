#!/usr/bin/env node
// Installs a locally built Orca.app over the copy in /Applications.
//
// A local build carries no signature and the bundle identifier never changes, so the
// previous app is moved aside rather than deleted: a build that starts and then misbehaves
// should still be recoverable by hand. Backups are pruned to the newest few.
//
// The running app has to go first. It keeps the old executable mapped, so replacing the
// bundle underneath it leaves the install half-updated and the new copy may fail to start.
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

export const DEFAULT_INSTALL_TARGET = '/Applications/Orca.app'
export const DEFAULT_BACKUP_COUNT = 3

// The backup name ends in the moment it was taken, so backups sort by recency even when
// the moved bundle carries the mtime of the app it used to be.
const BACKUP_STAMP_PATTERN = /-(\d{8}-\d{6})$/

export function readBundleVersion(appPath) {
  const plistPath = join(appPath, 'Contents/Info.plist')
  if (!existsSync(plistPath)) {
    return null
  }
  const plist = readFileSync(plistPath, 'utf8')
  const match = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]*)<\/string>/.exec(plist)
  return match?.[1] ?? null
}

export function formatBackupStamp(timestamp) {
  const date = new Date(timestamp)
  const pad = (value) => String(value).padStart(2, '0')
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const clock = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `${day}-${clock}`
}

export function backupPathFor(targetApp, version, timestamp) {
  const suffix = `${version ?? 'unknown'}-${formatBackupStamp(timestamp)}`
  return join(dirname(targetApp), `${basename(targetApp)}.bak-${suffix}`)
}

/**
 * List the backups of an installed app, newest first.
 *
 * @param {string} targetApp
 * @returns {{ name: string, path: string, stamp: string }[]}
 */
export function listAppBackups(targetApp) {
  const parent = dirname(targetApp)
  const prefix = `${basename(targetApp)}.bak-`
  if (!existsSync(parent)) {
    return []
  }
  return readdirSync(parent)
    .filter((entry) => entry.startsWith(prefix))
    .filter((entry) => statSync(join(parent, entry)).isDirectory())
    .map((entry) => ({
      name: entry,
      path: join(parent, entry),
      stamp: BACKUP_STAMP_PATTERN.exec(entry)?.[1] ?? ''
    }))
    .sort((left, right) => right.stamp.localeCompare(left.stamp))
}

/**
 * Delete the oldest backups beyond the keep count.
 *
 * Only backups this script created are pruned. A hand-made backup — one whose name carries no
 * stamp — is left alone: it may be the only copy of a release build nobody can rebuild.
 *
 * @param {string} targetApp
 * @param {number} keep how many backups to keep
 * @returns {string[]} the removed backup paths
 */
export function pruneAppBackups(targetApp, keep = DEFAULT_BACKUP_COUNT) {
  const removed = []
  const stamped = listAppBackups(targetApp).filter((backup) => backup.stamp !== '')
  for (const backup of stamped.slice(keep)) {
    rmSync(backup.path, { recursive: true, force: true })
    removed.push(backup.path)
  }
  return removed
}

function isRunning(executablePath) {
  const result = spawnSync('pgrep', ['-f', executablePath], { encoding: 'utf8' })
  return result.status === 0
}

/**
 * Quit the installed app so its bundle can be replaced.
 *
 * @param {string} targetApp
 * @param {(command: string, args: string[]) => void} run
 * @returns {boolean} whether a running app was stopped
 */
export function stopRunningApp(targetApp, run = execFileSync) {
  const executablePath = join(targetApp, 'Contents/MacOS/Orca')
  if (!isRunning(executablePath)) {
    return false
  }
  // pkill exits 1 when nothing matched, which happens when the app exits on its own
  // between the liveness check and the signal.
  const signal = (signalName) => {
    try {
      run('pkill', [signalName, '-f', executablePath])
    } catch {
      // The app is already gone.
    }
  }
  signal('-TERM')
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (!isRunning(executablePath)) {
      return true
    }
    spawnSync('sleep', ['0.2'])
  }
  signal('-KILL')
  return true
}

/**
 * Install a built app over the installed copy, keeping the previous one as a backup.
 *
 * @param {{ sourceApp: string, targetApp?: string, keepBackups?: number, timestamp?: number,
 *   run?: (command: string, args: string[]) => void }} options
 * @returns {{ sourceVersion: string | null, installedVersion: string | null,
 *   backupPath: string | null, removedBackups: string[] }}
 */
export function installMacApp({
  sourceApp,
  targetApp = DEFAULT_INSTALL_TARGET,
  keepBackups = DEFAULT_BACKUP_COUNT,
  timestamp = Date.now(),
  run = execFileSync
}) {
  if (!existsSync(sourceApp)) {
    throw new Error(`The built app is missing: ${sourceApp}`)
  }
  if (!existsSync(join(sourceApp, 'Contents/MacOS/Orca'))) {
    throw new Error(`The built app has no executable: ${join(sourceApp, 'Contents/MacOS/Orca')}`)
  }
  const sourceVersion = readBundleVersion(sourceApp)

  const stopped = stopRunningApp(targetApp, run)
  if (stopped) {
    console.log(`[install] stopped the running ${targetApp}`)
  }

  let backupPath = null
  if (existsSync(targetApp)) {
    backupPath = backupPathFor(targetApp, readBundleVersion(targetApp), timestamp)
    // A build repeated within the same second would land on the same backup name.
    rmSync(backupPath, { recursive: true, force: true })
    renameSync(targetApp, backupPath)
    console.log(`[install] moved the previous app to ${backupPath}`)
  }

  // ditto keeps the framework symlinks and extended attributes a plain copy breaks.
  run('ditto', [sourceApp, targetApp])

  const installedVersion = readBundleVersion(targetApp)
  if (installedVersion !== sourceVersion) {
    throw new Error(
      `The installed app reports version ${installedVersion ?? 'unknown'}, but the build reports ` +
        `${sourceVersion ?? 'unknown'}. The copy did not land.`
    )
  }

  const removedBackups = pruneAppBackups(targetApp, keepBackups)
  for (const removed of removedBackups) {
    console.log(`[install] removed the old backup ${removed}`)
  }
  console.log(`[install] installed ${targetApp} (${installedVersion})`)
  return { sourceVersion, installedVersion, backupPath, removedBackups }
}

if (process.argv[1] && resolveSameFile(process.argv[1], import.meta.filename)) {
  const args = process.argv.slice(2)
  const readOption = (name, fallback) => {
    const index = args.indexOf(name)
    return index !== -1 && args[index + 1] ? args[index + 1] : fallback
  }
  const sourceApp = readOption('--source', 'dist/mac/Orca.app')
  const targetApp = readOption('--target', DEFAULT_INSTALL_TARGET)
  const keepBackups = Number(readOption('--keep', String(DEFAULT_BACKUP_COUNT)))
  installMacApp({ sourceApp, targetApp, keepBackups })
  if (args.includes('--launch')) {
    execFileSync('open', ['-g', '-a', targetApp])
    console.log(`[install] relaunched ${targetApp}`)
  }
  process.exit(0)
}

function resolveSameFile(left, right) {
  try {
    return realpathSync(left) === realpathSync(right)
  } catch {
    return false
  }
}
