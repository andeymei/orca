import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { collectElectronImporters } from './check-runtime-electron-ratchet.mjs'

const ROOT = path.join(import.meta.dirname, '../../..', '..')

// The runtime reaches the refactoring feature through the method, and the CLI's copy of it is the
// same module the runtime loads; the translation they use must not drag Electron in with it.
const REFACTOR_ENTRY_POINTS = [
  'src/main/runtime/rpc/methods/refactor/refactor-methods.ts',
  'src/main/refactor/refactor-messages.ts',
  'src/main/refactor/refactor-plan-messages.ts'
].map((file) => path.join(ROOT, file))

// The half the refactoring copy reads: the i18next instance and the catalogs, and nothing that
// needs the Electron app.
const TRANSLATION_ENTRY_POINTS = [path.join(ROOT, 'src/main/i18n/main-i18n-translation.ts')]

describe('the refactoring feature on the plain-Node side of the i18n boundary', () => {
  it('reaches no Electron module', async () => {
    expect(await collectElectronImporters(REFACTOR_ENTRY_POINTS)).toEqual([])
  })

  it('translates through a module that reaches no Electron module', async () => {
    expect(await collectElectronImporters(TRANSLATION_ENTRY_POINTS)).toEqual([])
  })
})
