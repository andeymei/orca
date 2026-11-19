import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { GENERAL_SETTING_ANCHORS } from '../general/general-setting-anchors'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import {
  DEFAULT_TRIGGER_DELAY_MS,
  MAX_TRIGGER_DELAY_MS,
  getDefaultCodeCompletionSettings,
  type CodeCompletionSettings
} from '../../../../../shared/code-completion/code-completion-settings'
import {
  NES_BACKEND_IDS,
  type NesBackendId
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
        label={t('auto.components.settings.editor.CodeCompletionSection.5c05e289b2', 'Base URL')}
        description={t(
          'auto.components.settings.editor.CodeCompletionSection.ebf2c373f9',
          "Where the completion request is sent. Required: Orca appends the protocol's path to it, such as /v1/messages for Anthropic Messages."
        )}
        control={
          <DebouncedSettingsTextInput
            aria-label={t(
              'auto.components.settings.editor.CodeCompletionSection.5c05e289b2',
              'Base URL'
            )}
            value={completion.baseUrl}
            commit={(baseUrl) => commit({ baseUrl })}
            className="w-72 text-xs"
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
            className="w-72 text-xs"
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
            className="w-72 text-xs"
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
