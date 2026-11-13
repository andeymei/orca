import { describe, expect, it } from 'vitest'
import { assertNoConcurrentPackaging } from './pack-fast.mjs'

describe('pack fast', () => {
  it('refuses to package while another packager is running', () => {
    const runner = () => ({ status: 0, stdout: '4242\n' })
    expect(() => assertNoConcurrentPackaging(runner)).toThrow(/Another electron-builder run/)
  })

  it('packages when no other packager is running', () => {
    const runner = () => ({ status: 1, stdout: '' })
    expect(() => assertNoConcurrentPackaging(runner)).not.toThrow()
  })
})
