import { translate } from '@/i18n/i18n'
import { searchKeywordTranslator } from '../search/settings-search-keywords'
import type { Translate } from '@/i18n/use-translate'

/**
 * The copy and the words the settings search matches the next edit suggestions by.
 * The section and the search index both read this entry, so they cannot drift.
 */
export function getCodeCompletionSearchEntry(t: Translate = translate): {
  title: string
  description: string
  keywords: string[]
} {
  // Named translateSearchKeyword so the catalog extraction sees the keys.
  const translateSearchKeyword = searchKeywordTranslator(t)
  return {
    title: t(
      'auto.components.settings.editor.code.completion.search.ee5c54cd86',
      'Next edit suggestions'
    ),
    description: t(
      'auto.components.settings.editor.code.completion.search.2f281c612e',
      'Ask a model for the edits it expects to come next, then accept them with Tab.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.editor.code.completion.search.ab383b1408',
        'code'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.editor.code.completion.search.6212ba4d86',
        'code completion'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.editor.code.completion.search.361158cc18',
        'completion'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.editor.code.completion.search.425530b8f2',
        'suggestions'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.editor.code.completion.search.1b5ff0171f',
        'next edit'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.editor.code.completion.search.b36d791e83',
        'autocomplete'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.editor.code.completion.search.7cd689d8f1',
        'ai'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.editor.code.completion.search.301c09a3a8',
        'model'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.editor.code.completion.search.eaa7a013e5',
        'tab'
      )
    ]
  }
}
