import { describe, expect, it, vi } from 'vitest'
import { readKeychainPassword, resetKeychainPromptSuppressionForTests } from './generic-password'

function timeoutError(): Error {
  return Object.assign(new Error('security timed out'), { code: 'ETIMEDOUT', stderr: '' })
}

describe('readKeychainPassword', () => {
  it('returns the stored password', async () => {
    resetKeychainPromptSuppressionForTests()
    const run = vi.fn().mockResolvedValue({ stdout: 'secret\n', stderr: '' })
    await expect(readKeychainPassword('Claude Code-credentials', 'user', run)).resolves.toBe(
      'secret'
    )
  })

  it('returns null for an item that does not exist', async () => {
    resetKeychainPromptSuppressionForTests()
    const run = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('not found'), { code: 44, stderr: 'could not be found' })
      )
    await expect(readKeychainPassword('Missing Item', 'user', run)).resolves.toBeNull()
  })

  it('stops re-raising a prompt nobody answered', async () => {
    resetKeychainPromptSuppressionForTests()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const run = vi.fn().mockRejectedValue(timeoutError())

    // The first attempt raises the macOS prompt and the user does not answer it.
    await expect(readKeychainPassword('Claude Code-credentials', 'user', run)).rejects.toThrow()
    expect(run).toHaveBeenCalledTimes(1)

    // The next poll must not raise it again.
    await expect(readKeychainPassword('Claude Code-credentials', 'user', run)).resolves.toBeNull()
    expect(run).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Always Allow'))

    warn.mockRestore()
  })

  it('keeps asking for a different item', async () => {
    resetKeychainPromptSuppressionForTests()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const run = vi.fn().mockRejectedValue(timeoutError())

    await expect(readKeychainPassword('Claude Code-credentials', 'user', run)).rejects.toThrow()
    await expect(readKeychainPassword('Cursor Safe Storage', 'Cursor', run)).rejects.toThrow()
    expect(run).toHaveBeenCalledTimes(2)

    warn.mockRestore()
  })
})
