import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertBackupPathInTargetDirectory,
  backupPathFor,
  formatBackupStamp,
  listAppBackups,
  nextAvailableBackupPath,
  pruneAppBackups,
  readBundleVersion,
  sanitizeBackupComponent
} from './mac-app-install.mjs'

function createAppBundle(root, name, version) {
  const appPath = join(root, name)
  mkdirSync(join(appPath, 'Contents/MacOS'), { recursive: true })
  writeFileSync(
    join(appPath, 'Contents/Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>CFBundleShortVersionString</key>
  <string>${version}</string>
</dict>
</plist>
`
  )
  return appPath
}

describe('mac app install', () => {
  it('reads the bundle version from the Info.plist', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-mac-install-'))
    try {
      const appPath = createAppBundle(root, 'Orca.app', '1.4.214-local.1700000000000.abcdef123456')
      expect(readBundleVersion(appPath)).toBe('1.4.214-local.1700000000000.abcdef123456')
      expect(readBundleVersion(join(root, 'missing.app'))).toBeNull()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('names a backup after the version it replaces and the moment it was taken', () => {
    const stamp = formatBackupStamp(new Date('2026-11-13T12:34:56').getTime())
    expect(stamp).toBe('20261113-123456')
    expect(backupPathFor('/Applications/Orca.app', '1.4.253', Date.now())).toMatch(
      /\/Applications\/Orca\.app\.bak-1\.4\.253-\d{8}-\d{6}$/
    )
  })

  it('lists backups newest first', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-mac-install-'))
    try {
      const target = join(root, 'Orca.app')
      createAppBundle(root, 'Orca.app.bak-1.4.250-20260101-010101', '1.4.250')
      createAppBundle(root, 'Orca.app.bak-1.4.253-20260202-020202', '1.4.253')
      createAppBundle(root, 'Orca.app.bak-1.4.254-20260303-030303', '1.4.254')
      createAppBundle(root, 'Unrelated.app.bak-1.0.0-20260404-040404', '1.0.0')

      expect(listAppBackups(target).map((backup) => backup.name)).toEqual([
        'Orca.app.bak-1.4.254-20260303-030303',
        'Orca.app.bak-1.4.253-20260202-020202',
        'Orca.app.bak-1.4.250-20260101-010101'
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps the newest backups and removes the rest', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-mac-install-'))
    try {
      const target = join(root, 'Orca.app')
      createAppBundle(root, 'Orca.app.bak-1.4.250-20260101-010101', '1.4.250')
      createAppBundle(root, 'Orca.app.bak-1.4.253-20260202-020202', '1.4.253')
      createAppBundle(root, 'Orca.app.bak-1.4.254-20260303-030303', '1.4.254')

      const removed = pruneAppBackups(target, 2)

      expect(removed).toHaveLength(1)
      expect(removed[0]).toContain('1.4.250')
      expect(listAppBackups(target).map((backup) => backup.name)).toEqual([
        'Orca.app.bak-1.4.254-20260303-030303',
        'Orca.app.bak-1.4.253-20260202-020202'
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('never prunes a hand-made backup', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-mac-install-'))
    try {
      const target = join(root, 'Orca.app')
      createAppBundle(root, 'Orca.app.bak-1.4.253', '1.4.253')
      createAppBundle(root, 'Orca.app.bak-1.4.254-20260303-030303', '1.4.254')

      expect(pruneAppBackups(target, 1)).toEqual([])
      expect(listAppBackups(target).map((backup) => backup.name)).toContain('Orca.app.bak-1.4.253')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps a hostile bundle version inside the backup directory', () => {
    expect(sanitizeBackupComponent('../../etc/passwd')).toBe('.._.._etc_passwd')
    expect(sanitizeBackupComponent('..')).toBe('unknown')
    expect(sanitizeBackupComponent('')).toBe('unknown')
    expect(sanitizeBackupComponent(null)).toBe('unknown')

    const backupPath = backupPathFor('/Applications/Orca.app', '../../etc/passwd', Date.now())
    expect(backupPath.startsWith('/Applications/Orca.app.bak-')).toBe(true)
    expect(backupPath).not.toContain('/etc/passwd')
    expect(() =>
      assertBackupPathInTargetDirectory(backupPath, '/Applications/Orca.app')
    ).not.toThrow()
    expect(() =>
      assertBackupPathInTargetDirectory('/etc/Orca.app.bak-x', '/Applications/Orca.app')
    ).toThrow(/outside/)
  })

  it('never writes a backup over an existing one', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-mac-install-'))
    try {
      const target = join(root, 'Orca.app')
      const timestamp = Date.now()
      const first = nextAvailableBackupPath(target, '1.4.253', timestamp)
      createAppBundle(root, first.slice(root.length + 1), '1.4.253')

      const second = nextAvailableBackupPath(target, '1.4.253', timestamp)
      expect(second).not.toBe(first)
      expect(second.startsWith(`${first}-`)).toBe(true)
      expect(listAppBackups(target).map((backup) => backup.stamp)).not.toContain('')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
