import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { disposeWatcherProcess } from '../../ipc/filesystem/watcher-process/parcel-watcher-process'
import {
  pluginManifestSchema,
  type PluginManifest
} from '../../../shared/plugins/manifest/plugin-manifest'
import {
  validateDeclaredPluginArtifacts,
  validatePluginInstallContent
} from './plugin-artifact-validation'
import { hashPluginTree } from './plugin-content-hash'

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orca-plugin-content-test-'))
  roots.push(root)
  return root
}

type ManifestOverrides = Omit<Partial<PluginManifest>, 'contributes'> & {
  contributes?: Partial<PluginManifest['contributes']>
}

function manifest(overrides: ManifestOverrides = {}): PluginManifest {
  const { contributes, ...manifestOverrides } = overrides
  return pluginManifestSchema.parse({
    manifestVersion: 1,
    id: 'demo',
    publisher: 'samples',
    name: 'Demo',
    version: '1.0.0',
    engines: { orca: '>=1.0.0' },
    pluginApi: 1,
    capabilities: [],
    ...manifestOverrides,
    contributes
  })
}

afterEach(async () => {
  vi.restoreAllMocks()
  // Release shared Parcel watches before deleting roots they may still own.
  disposeWatcherProcess()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('declared plugin artifacts', () => {
  it('refuses a declared path that differs from the file only by case', async () => {
    const root = await tempRoot()
    await mkdir(join(root, 'locales'))
    await writeFile(join(root, 'locales', 'pt-BR.json'), '{}')
    const pluginManifest = manifest({
      contributes: { languagePacks: [{ locale: 'pt-BR', path: 'locales/pt-br.json' }] }
    })

    const result = await validateDeclaredPluginArtifacts(root, pluginManifest)
    expect(result).toMatchObject({ ok: false })
    // Why conditional: only case-insensitive filesystems (APFS, NTFS) resolve the wrong spelling.
    if (existsSync(join(root, 'locales', 'pt-br.json'))) {
      expect(result).toMatchObject({ error: expect.stringContaining('is spelled "pt-BR.json"') })
      await expect(
        validateDeclaredPluginArtifacts(root, pluginManifest, { allowCaseMismatch: true })
      ).resolves.toEqual({ ok: true })
    }
  })

  it('rejects duplicate VM recipe ids at the immutable install boundary', async () => {
    const root = await tempRoot()
    await mkdir(join(root, 'recipes'))
    const recipe = JSON.stringify({
      schemaVersion: 1,
      id: 'cloud',
      name: 'Cloud',
      create: 'create'
    })
    await Promise.all([
      writeFile(join(root, 'recipes', 'one.json'), recipe),
      writeFile(join(root, 'recipes', 'two.json'), recipe)
    ])
    const pluginManifest = manifest({
      contributes: {
        vmRecipes: [{ path: 'recipes/one.json' }, { path: 'recipes/two.json' }]
      }
    })

    await expect(validatePluginInstallContent(root, pluginManifest)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('duplicate VM recipe id "cloud"')
    })
  })
})

describe('hash-addressed plugin content', () => {
  it('uses unambiguous framing for paths and file contents', async () => {
    const first = await tempRoot()
    const second = await tempRoot()
    await writeFile(join(first, 'a'), Buffer.from('x\0b\0y'))
    await Promise.all([writeFile(join(second, 'a'), 'x'), writeFile(join(second, 'b'), 'y')])

    const [firstHash, secondHash] = await Promise.all([
      hashPluginTree(first),
      hashPluginTree(second)
    ])

    expect(firstHash).toMatchObject({ ok: true })
    expect(secondHash).toMatchObject({ ok: true })
    if (firstHash.ok && secondHash.ok) {
      expect(firstHash.hash).not.toBe(secondHash.hash)
    }
  })

  it('a tree with generated typings hashes as the tree without them', async () => {
    // Why: `.orca` holds the typings `orca plugin types` writes; the packaging drops the folder and
    // the runtime never reads it, so it must not change what a plugin's content identity is.
    const plain = await tempRoot()
    const generated = await tempRoot()
    await writeFile(join(plain, 'orca-plugin.json'), '{}')
    await writeFile(join(generated, 'orca-plugin.json'), '{}')
    await mkdir(join(generated, '.orca', 'types'), { recursive: true })
    await writeFile(join(generated, '.orca', 'types', 'orca.d.ts'), 'export {}')

    const [plainHash, generatedHash, devHash] = await Promise.all([
      hashPluginTree(plain),
      hashPluginTree(generated),
      hashPluginTree(generated, { devFolder: true })
    ])

    expect(plainHash).toMatchObject({ ok: true })
    expect(generatedHash).toMatchObject({ ok: true })
    expect(devHash).toMatchObject({ ok: true })
    if (plainHash.ok && generatedHash.ok && devHash.ok) {
      expect(generatedHash.hash).toBe(plainHash.hash)
      expect(devHash.hash).toBe(plainHash.hash)
    }
  })
})
