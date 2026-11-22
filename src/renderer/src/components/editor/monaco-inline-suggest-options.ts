import type { editor } from 'monaco-editor'

/**
 * The `experimental` block of the inline-suggestion options.
 *
 * Monaco reads it at runtime but does not declare it in its public type, so it is declared here
 * rather than cast into place.
 */
type InlineSuggestExperimental = {
  readonly showOnSuggestConflict: 'always' | 'never' | 'whenSuggestListIsIncomplete'
}

export type InlineSuggestOptions = editor.IInlineSuggestOptions & {
  readonly experimental: InlineSuggestExperimental
}

export const MONACO_INLINE_SUGGEST_OPTIONS: InlineSuggestOptions = {
  experimental: {
    // Why: Monaco hides the inline suggestion while the suggest widget holds a focused item, and
    // the widget opens on every identifier the user types. The conflict is settled in favour of
    // the inline suggestion, which is the one the user asked for.
    showOnSuggestConflict: 'always'
  }
}
