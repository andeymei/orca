import { describe, expect, it } from 'vitest'
import { normalizeRightSidebarTab } from './ui-selection-normalization'

describe('normalizeRightSidebarTab', () => {
  it('falls back to the explorer tab when the saved tab is not one the app knows', () => {
    expect(normalizeRightSidebarTab('background-agents')).toBe('explorer')
  })

  it('keeps a tab the app knows', () => {
    expect(normalizeRightSidebarTab('vault')).toBe('vault')
  })
})
