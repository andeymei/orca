import { describe, expect, it } from 'vitest'
import { decideNesTabAction } from './nes-key-routing'

describe('decideNesTabAction', () => {
  it('accepts the suggestion when one is showing', () => {
    expect(decideNesTabAction({ hasInlineSuggestion: true, hasOtherLocations: true })).toBe(
      'accept-suggestion'
    )
    expect(decideNesTabAction({ hasInlineSuggestion: true, hasOtherLocations: false })).toBe(
      'accept-suggestion'
    )
  })

  it('jumps to the next location when the plan has more', () => {
    expect(decideNesTabAction({ hasInlineSuggestion: false, hasOtherLocations: true })).toBe(
      'jump-to-next-location'
    )
  })

  it('passes the key through when there is nothing to do', () => {
    expect(decideNesTabAction({ hasInlineSuggestion: false, hasOtherLocations: false })).toBe(
      'pass-through'
    )
  })
})
