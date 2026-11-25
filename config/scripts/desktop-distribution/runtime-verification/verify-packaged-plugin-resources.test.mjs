import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hashPluginTree } from '../../../../src/main/plugins/artifacts/plugin-content-hash.ts'

const require = createRequire(import.meta.url)
const { hashPackagedPluginTree } = require('./verify-packaged-plugin-resources.cjs')

const launchRoot = resolve(process.cwd(), 'resources', 'plugins', 'launch')
const index = JSON.parse(await readFile(join(launchRoot, 'bundled-plugins.json'), 'utf8'))

/** The tree the packaging copies: the checkout without the generated typings it drops. */
async function packagedTreeOf(source) {
  const target = await mkdtemp(join(tmpdir(), 'orca-bundled-plugin-package-'))
  await cp(source, target, { recursive: true })
  await rm(join(target, '.orca'), { recursive: true, force: true })
  return target
}

describe('the bundled plugin index', () => {
  it('ships the board as a bundled plugin', () => {
    expect(index.plugins.map((entry) => entry.pluginKey)).toContain('stablyai.spec-board')
  })

  it('names the tree the runtime hashes, in the checkout and in the package', async () => {
    // Why: an unpackaged run installs from the checkout, a packaged one from the copy; both must
    // be the bytes the index names, or the bootstrap refuses the plugin it ships.
    for (const entry of index.plugins) {
      const checkout = await hashPluginTree(join(launchRoot, entry.path))
      expect(checkout.ok, entry.pluginKey).toBe(true)
      expect(checkout.ok && checkout.hash, entry.pluginKey).toBe(entry.contentHash)

      const packaged = await packagedTreeOf(join(launchRoot, entry.path))
      try {
        const packagedHash = await hashPluginTree(packaged)
        expect(packagedHash.ok, entry.pluginKey).toBe(true)
        expect(packagedHash.ok && packagedHash.hash, entry.pluginKey).toBe(entry.contentHash)
        expect(hashPackagedPluginTree(packaged), entry.pluginKey).toBe(entry.contentHash)
      } finally {
        await rm(packaged, { recursive: true, force: true })
      }
    }
  })
})
