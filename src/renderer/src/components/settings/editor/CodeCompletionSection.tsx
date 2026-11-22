import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { GENERAL_SETTING_ANCHORS } from '../general/general-setting-anchors'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import {
  DEFAULT_CONTEXT_PREFIX_CHARS,
  DEFAULT_CONTEXT_SUFFIX_CHARS,
  DEFAULT_DISPLAY_DEADLINE_MS,
  DEFAULT_TRIGGER_DELAY_MS,
  MAX_CONTEXT_CHARS,
  MAX_DISPLAY_DEADLINE_MS,
  MAX_TRIGGER_DELAY_MS,
  MIN_CONTEXT_CHARS,
  getDefaultCodeCompletionSettings,
  type CodeCompletionSettings
} from '../../../../../shared/code-completion/code-completion-settings'
import {
  NES_BACKEND_IDS,
  NES_RESPONSE_MODES,
  type NesBackendId,
  type NesResponseMode
} from '../../../../../shared/code-completion/code-completion-types'
import type { CodeCompletionCredentialsStatus } from '../../../../../shared/code-completion/code-completion-credentials-status'
import { SearchableSetting } from '../section-layout/SearchableSetting'
import {
  NumberField,
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSwitchRow
} from '../form-controls/SettingsFormControls'
import { DebouncedSettingsTextInput } from '../form-controls/DebouncedSettingsTextInput'
import { CodeCompletionCredentialSetting } from './CodeCompletionCredentialSetting'
import { getCodeCompletionSearchEntry } from './code-completion-search'
import { useIntlLocale, useTranslate } from '@/i18n/use-translate'

type CodeCompletionSectionProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function CodeCompletionSection({
  settings,
  updateSettings
}: CodeCompletionSectionProps): React.JSX.Element {
  const t = useTranslate()
  const intlLocale = useIntlLocale()
  const entry = getCodeCompletionSearchEntry(t)
  // A stable fallback keeps the write ref from resetting on every render.
  const [defaultCompletion] = useState(getDefaultCodeCompletionSettings)
  const completion = settings.codeCompletion ?? defaultCompletion
  const [status, setStatus] = useState<CodeCompletionCredentialsStatus | null>(null)

  // Why: the normalizer resets every field it is not given, so a write carries the whole block.
  // The ref holds the newest block, so a second write before the first echo lands does not undo it.
  const completionRef = useRef(completion)
  useEffect(() => {
    completionRef.current = completion
  }, [completion])

  const commit = (next: Partial<CodeCompletionSettings>): void => {
    const merged = { ...completionRef.current, ...next }
    completionRef.current = merged
    updateSettings({ codeCompletion: merged })
  }

  // Why: the runtime asks for nothing without a key, an endpoint and a model, so the section names what is missing.
  const missingRequirements: string[] = []
  if (status !== null && !status.configured) {
    missingRequirements.push(
      t('auto.components.settings.editor.CodeCompletionSection.62a1f4af68', 'save an API key')
    )
  }
  if (completion.baseUrl.trim().length === 0) {
    missingRequirements.push(
      t('auto.components.settings.editor.CodeCompletionSection.4c769faa40', 'set the endpoint')
    )
  }
  if (completion.model.trim().length === 0) {
    missingRequirements.push(
      t('auto.components.settings.editor.CodeCompletionSection.d4579c57ce', 'choose a model')
    )
  }
  const readinessMessage =
    missingRequirements.length > 0
      ? t(
          'auto.components.settings.editor.CodeCompletionSection.6fa1e4323f',
          'Next edit suggestions stay off until you {{requirements}}.',
          {
            requirements: new Intl.ListFormat(intlLocale, { type: 'conjunction' }).format(
              missingRequirements
            )
          }
        )
      : null

  const protocolLabels: Record<NesBackendId, string> = {
    'anthropic-messages': t(
      'auto.components.settings.editor.CodeCompletionSection.93ed07a8a9',
      'Anthropic Messages'
    ),
    'openai-chat': t(
      'auto.components.settings.editor.CodeCompletionSection.ff49e75185',
      'OpenAI Chat'
    ),
    'openai-completions-fim': t(
      'auto.components.settings.editor.CodeCompletionSection.55e4686ab8',
      'OpenAI FIM'
    )
  }

  const responseModeLabels: Record<NesResponseMode, string> = {
    inline: t('auto.components.settings.editor.CodeCompletionSection.inline-mode', 'Inline'),
    plan: t('auto.components.settings.editor.CodeCompletionSection.plan-mode', 'Next edit')
  }

  // Why: the fill-in-the-middle endpoint answers with text, so it cannot answer a plan of edits.
  const planModeAvailable = completion.protocol !== 'openai-completions-fim'

  return (
    <SearchableSetting
      id={GENERAL_SETTING_ANCHORS.codeCompletion}
      title={entry.title}
      description={entry.description}
      keywords={entry.keywords}
      className="space-y-0"
    >
      <SettingsSwitchRow
        label={entry.title}
        description={entry.description}
        checked={completion.enabled}
        onChange={() => commit({ enabled: !completion.enabled })}
      />

      {readinessMessage ? (
        <p role="status" className="py-2 text-xs text-muted-foreground">
          {readinessMessage}
        </p>
      ) : null}

      <SettingsRow
        className="border-t border-border"
        label={t('auto.components.settings.editor.CodeCompletionSection.dfddbe2660', 'Protocol')}
        description={t(
          'auto.components.settings.editor.CodeCompletionSection.41a5da86af',
          'The API shape the endpoint speaks.'
        )}
        control={
          <SettingsSegmentedControl
            ariaLabel={t(
              'auto.components.settings.editor.CodeCompletionSection.dfddbe2660',
              'Protocol'
            )}
            value={completion.protocol}
            onChange={(protocol) => commit({ protocol })}
            options={NES_BACKEND_IDS.map((id) => ({ value: id, label: protocolLabels[id] }))}
          />
        }
      />

      <SettingsRow
        className="border-t border-border"
        label={t(
          'auto.components.settings.editor.CodeCompletionSection.response-mode',
          'What to ask for'
        )}
        description={
          planModeAvailable
            ? t(
                'auto.components.settings.editor.CodeCompletionSection.response-mode-description',
                'Inline asks for the text to insert at the cursor, which the model can answer without counting lines. Next edit asks for a plan of changes and can propose them anywhere in the file.'
              )
            : t(
                'auto.components.settings.editor.CodeCompletionSection.response-mode-fim-description',
                'The fill-in-the-middle endpoint answers with text, so it always answers inline.'
              )
        }
        control={
          <SettingsSegmentedControl
            ariaLabel={t(
              'auto.components.settings.editor.CodeCompletionSection.response-mode',
              'What to ask for'
            )}
            value={completion.responseMode}
            onChange={(responseMode) => commit({ responseMode })}
            options={NES_RESPONSE_MODES.map((mode) => ({
              value: mode,
              label: responseModeLabels[mode],
              disabled: mode === 'plan' && !planModeAvailable
            }))}
          />
        }
      />

      <SettingsRow
        className="border-t border-border"
        label={t('auto.components.settings.editor.CodeCompletionSection.5c05e289b2', 'Base URL')}
        description={t(
          'auto.components.settings.editor.CodeCompletionSection.9e5354b432',
          'Where the completion request is sent. Required: the base URL without the path Orca appends — Anthropic Messages takes https://api.anthropic.com and appends /v1/messages, OpenAI Chat takes https://api.openai.com/v1 and appends /chat/completions, and OpenAI FIM takes https://api.openai.com/v1 and appends /completions.'
        )}
        control={
          <DebouncedSettingsTextInput
            aria-label={t(
              'auto.components.settings.editor.CodeCompletionSection.5c05e289b2',
              'Base URL'
            )}
            value={completion.baseUrl}
            commit={(baseUrl) => commit({ baseUrl })}
            variant="code"
            className="w-72"
          />
        }
      />

      <SettingsRow
        className="border-t border-border"
        label={t('auto.components.settings.editor.CodeCompletionSection.2208e4af93', 'Model')}
        description={t(
          'auto.components.settings.editor.CodeCompletionSection.b69a2a51c9',
          'Which model the endpoint is asked to predict the next edits with. Required.'
        )}
        control={
          <DebouncedSettingsTextInput
            aria-label={t(
              'auto.components.settings.editor.CodeCompletionSection.2208e4af93',
              'Model'
            )}
            value={completion.model}
            commit={(model) => commit({ model })}
            variant="code"
            className="w-72"
          />
        }
      />

      <CodeCompletionCredentialSetting status={status} onStatusChange={setStatus} />

      <NumberField
        className="border-t border-border"
        label={t(
          'auto.components.settings.editor.CodeCompletionSection.0a392011b5',
          'Trigger delay'
        )}
        description={t(
          'auto.components.settings.editor.CodeCompletionSection.016631d629',
          'How long Orca waits after you stop typing before it asks for the next edits.'
        )}
        defaultValue={DEFAULT_TRIGGER_DELAY_MS}
        min={0}
        max={MAX_TRIGGER_DELAY_MS}
        step={50}
        integer
        suffix={t('auto.components.settings.editor.CodeCompletionSection.2a22a3771c', 'ms')}
        value={completion.triggerDelayMs}
        onChange={(triggerDelayMs) => commit({ triggerDelayMs })}
      />

      <NumberField
        className="border-t border-border"
        label={t(
          'auto.components.settings.editor.CodeCompletionSection.context-prefix',
          'Context before the cursor'
        )}
        description={t(
          'auto.components.settings.editor.CodeCompletionSection.context-prefix-description',
          'How much of the file before the cursor is sent. More context costs time and tokens.'
        )}
        defaultValue={DEFAULT_CONTEXT_PREFIX_CHARS}
        min={MIN_CONTEXT_CHARS}
        max={MAX_CONTEXT_CHARS}
        step={500}
        integer
        suffix={t('auto.components.settings.editor.CodeCompletionSection.chars', 'chars')}
        value={completion.contextPrefixChars}
        onChange={(contextPrefixChars) => commit({ contextPrefixChars })}
      />

      <NumberField
        className="border-t border-border"
        label={t(
          'auto.components.settings.editor.CodeCompletionSection.context-suffix',
          'Context after the cursor'
        )}
        description={t(
          'auto.components.settings.editor.CodeCompletionSection.context-suffix-description',
          'How much of the file after the cursor is sent.'
        )}
        defaultValue={DEFAULT_CONTEXT_SUFFIX_CHARS}
        min={MIN_CONTEXT_CHARS}
        max={MAX_CONTEXT_CHARS}
        step={500}
        integer
        suffix={t('auto.components.settings.editor.CodeCompletionSection.chars', 'chars')}
        value={completion.contextSuffixChars}
        onChange={(contextSuffixChars) => commit({ contextSuffixChars })}
      />

      <NumberField
        className="border-t border-border"
        label={t(
          'auto.components.settings.editor.CodeCompletionSection.display-deadline',
          'Answer deadline'
        )}
        description={t(
          'auto.components.settings.editor.CodeCompletionSection.display-deadline-description',
          'How long an answer may take before it is no longer shown. Zero waits as long as the endpoint takes.'
        )}
        defaultValue={DEFAULT_DISPLAY_DEADLINE_MS}
        min={0}
        max={MAX_DISPLAY_DEADLINE_MS}
        step={500}
        integer
        suffix={t('auto.components.settings.editor.CodeCompletionSection.2a22a3771c', 'ms')}
        value={completion.displayDeadlineMs}
        onChange={(displayDeadlineMs) => commit({ displayDeadlineMs })}
      />

      <SettingsSwitchRow
        className="border-t border-border"
        label={t('auto.components.settings.editor.CodeCompletionSection.3e8b886968', 'Auto import')}
        description={t(
          'auto.components.settings.editor.CodeCompletionSection.b48c20da2a',
          'Let the model add the imports the suggested edit needs.'
        )}
        checked={completion.autoImport}
        onChange={() => commit({ autoImport: !completion.autoImport })}
      />

      <SettingsRow
        className="border-t border-border"
        label={t(
          'auto.components.settings.editor.CodeCompletionSection.679889f02f',
          'Enabled extensions'
        )}
        description={t(
          'auto.components.settings.editor.CodeCompletionSection.424ecd45b2',
          'The file extensions the suggestion runs in. Separate them with commas.'
        )}
        control={
          <DebouncedSettingsTextInput
            aria-label={t(
              'auto.components.settings.editor.CodeCompletionSection.679889f02f',
              'Enabled extensions'
            )}
            value={completion.enabledExtensions.join(', ')}
            commit={(next) => commit({ enabledExtensions: parseExtensions(next) })}
            variant="code"
            className="w-72"
          />
        }
      />
    </SearchableSetting>
  )
}

/** The editor matches the extension without its dot, so the list is stored the same way. */
function parseExtensions(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim().replace(/^\./, '').toLowerCase())
    .filter((entry) => entry.length > 0)
}
