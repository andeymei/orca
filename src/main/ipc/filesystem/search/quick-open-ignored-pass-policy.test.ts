import { describe, expect, it } from 'vitest'

import { shouldScanIgnoredFiles } from './quick-open-ignored-pass-policy'

describe('shouldScanIgnoredFiles', () => {
  it('skips the ignored scan when the tracked scan already filled the result limit', () => {
    expect(
      shouldScanIgnoredFiles({ includeIgnored: true, primaryMatchCount: 4168, limit: 32 })
    ).toBe(false)
  })

  it('scans ignored files when the tracked scan left the result set short', () => {
    expect(shouldScanIgnoredFiles({ includeIgnored: true, primaryMatchCount: 3, limit: 32 })).toBe(
      true
    )
  })

  it('never scans ignored files when the user turned them off', () => {
    expect(shouldScanIgnoredFiles({ includeIgnored: false, primaryMatchCount: 0, limit: 32 })).toBe(
      false
    )
  })
})
