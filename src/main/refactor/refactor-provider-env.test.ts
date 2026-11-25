import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readRefactorProviderEnv } from './refactor-provider-env'

/** A config dir holding the settings file a host's Claude reads. */
async function configDirWith(settings: unknown): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'refactor-provider-env-'))
  await writeFile(path.join(dir, 'settings.json'), JSON.stringify(settings), 'utf8')
  return dir
}

describe('readRefactorProviderEnv', () => {
  it('carries the provider connection a gateway host keeps in its settings', async () => {
    const dir = await configDirWith({
      env: {
        ANTHROPIC_BASE_URL: 'https://gateway.example.invalid',
        ANTHROPIC_AUTH_TOKEN: 'token-value',
        ANTHROPIC_MODEL: 'MiniMax-M3.1-Flash'
      }
    })

    expect(await readRefactorProviderEnv(dir)).toEqual({
      ANTHROPIC_BASE_URL: 'https://gateway.example.invalid',
      ANTHROPIC_AUTH_TOKEN: 'token-value',
      ANTHROPIC_MODEL: 'MiniMax-M3.1-Flash'
    })
  })

  it('leaves out everything the provider connection does not need', async () => {
    // Why: the refactoring agent runs with the tool gate as its only arbiter, so it gets the
    // provider connection and not the rest of a settings file's environment.
    const dir = await configDirWith({
      env: {
        ANTHROPIC_BASE_URL: 'https://gateway.example.invalid',
        GITHUB_PERSONAL_ACCESS_TOKEN: 'secret',
        BASH_ENV: '/tmp/other.sh'
      },
      permissions: { allow: ['Write'] }
    })

    expect(await readRefactorProviderEnv(dir)).toEqual({
      ANTHROPIC_BASE_URL: 'https://gateway.example.invalid'
    })
  })

  it('carries nothing when the host has no settings file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'refactor-provider-env-'))

    expect(await readRefactorProviderEnv(dir)).toEqual({})
  })

  it('carries nothing when the settings file is not JSON', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'refactor-provider-env-'))
    await writeFile(path.join(dir, 'settings.json'), '{ not json', 'utf8')

    expect(await readRefactorProviderEnv(dir)).toEqual({})
  })

  it('carries nothing when the settings file holds no env block', async () => {
    const dir = await configDirWith({ permissions: { allow: ['Write'] } })

    expect(await readRefactorProviderEnv(dir)).toEqual({})
  })

  it('skips a provider variable that is empty', async () => {
    const dir = await configDirWith({
      env: { ANTHROPIC_BASE_URL: 'https://gateway.example.invalid', ANTHROPIC_AUTH_TOKEN: '  ' }
    })

    expect(await readRefactorProviderEnv(dir)).toEqual({
      ANTHROPIC_BASE_URL: 'https://gateway.example.invalid'
    })
  })
})
