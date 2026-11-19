/** What the Tab key does when a next-edit suggestion is on the table. */
export type NesTabDecision = 'accept-suggestion' | 'jump-to-next-location' | 'pass-through'

/**
 * The one rule the Tab shortcut follows. `pass-through` leaves the key alone, so the editor's own
 * suggest widget still gets it.
 */
export function decideNesTabAction(input: {
  hasInlineSuggestion: boolean
  hasOtherLocations: boolean
}): NesTabDecision {
  if (input.hasInlineSuggestion) {
    return 'accept-suggestion'
  }
  if (input.hasOtherLocations) {
    return 'jump-to-next-location'
  }
  return 'pass-through'
}
