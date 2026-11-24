import type { editor } from 'monaco-editor'
import type { GlobalSettings } from '../../../../../shared/settings/global-settings-types'
import {
  DEFAULT_CONTEXT_PREFIX_CHARS,
  DEFAULT_CONTEXT_SUFFIX_CHARS,
  DEFAULT_DISPLAY_DEADLINE_MS,
  DEFAULT_TRIGGER_DELAY_MS
} from '../../../../../shared/code-completion/code-completion-settings'
import type { NesNextEdit } from './nes-next-edit'
import { useMonacoNextEditSuggestions } from './use-monaco-nes'

/** The extensions that are off; a file outside the list is skipped whole. */
const NO_ENABLED_EXTENSIONS: readonly string[] = []

/**
 * The next-edit suggestion, wired to the editor's own settings.
 *
 * Why it lives apart from the editor: the editor asks for the suggestion, and this knows what
 * the settings say about it.
 */
export function useMonacoNesFeature(params: {
  filePath: string | undefined
  relativePath: string | undefined
  settings: GlobalSettings | null | undefined
  /** A mirror of another tab's record must not ask for plans of its own. */
  passiveMirror: boolean
  editorInstance: editor.IStandaloneCodeEditor | null
}): {
  /** The edit the cursor cannot show, when the plan holds one the user should look at. */
  nextEdit: NesNextEdit | null
} {
  const codeCompletion = params.settings?.codeCompletion
  return useMonacoNextEditSuggestions({
    filePath: params.filePath,
    relativePath: params.relativePath,
    enabled: Boolean(codeCompletion?.enabled) && !params.passiveMirror,
    triggerDelayMs: codeCompletion?.triggerDelayMs ?? DEFAULT_TRIGGER_DELAY_MS,
    enabledExtensions: codeCompletion?.enabledExtensions ?? NO_ENABLED_EXTENSIONS,
    contextPrefixChars: codeCompletion?.contextPrefixChars ?? DEFAULT_CONTEXT_PREFIX_CHARS,
    contextSuffixChars: codeCompletion?.contextSuffixChars ?? DEFAULT_CONTEXT_SUFFIX_CHARS,
    displayDeadlineMs: codeCompletion?.displayDeadlineMs ?? DEFAULT_DISPLAY_DEADLINE_MS,
    completionModel: codeCompletion?.model ?? '',
    editorInstance: params.editorInstance
  })
}
