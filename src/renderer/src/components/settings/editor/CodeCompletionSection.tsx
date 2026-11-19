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
import type { CodeCompletionCredentialsStatus } from '../../../../../shared/code-completion/code-completion-credentials-status'
import { SearchableSetting } from '../section-layout/SearchableSetting'
import {
  NumberField,
  SettingsBadge,
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSwitchRow
} from '../form-controls/SettingsFormControls'
import { DebouncedSettingsTextInput } from '../form-controls/DebouncedSettingsTextInput'
import { UnsealedCredentialNotice } from '../../provider-accounts/UnsealedCredentialNotice'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { useTranslate } from '@/i18n/use-translate'

/** The credential probe reads the sealed file from disk, so the status is polled instead of read per render. */
const CREDENTIAL_STATUS_POLL_MS = 5_000

type CodeCompletionSectionProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function CodeCompletionSection({
  settings,
  updateSettings
}: CodeCompletionSectionProps): React.JSX.Element {
  const t = useTranslate()
  // A stable fallback keeps the write ref from resetting on every render.
  const [defaultCompletion] = useState(getDefaultCodeCompletionSettings)
  const completion = settings.codeCompletion ?? defaultCompletion
  const [status, setStatus] = useState<CodeCompletionCredentialsStatus | null>(null)
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [apiKeyBusy, setApiKeyBusy] = useState(false)

  useEffect(() => {
    let disposed = false
    const readStatus = (): void => {
      void window.api.codeCompletion
        .getStatus()
        .then((next) => {
          if (!disposed) {
            setStatus(next)
          }
        })
        .catch(() => {})
    }
    readStatus()
    const timer = setInterval(readStatus, CREDENTIAL_STATUS_POLL_MS)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [])

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

  const saveApiKey = (): void => {
    const key = apiKeyDraft.trim()
    if (!key) {
      return
    }
    setApiKeyBusy(true)
    void window.api.codeCompletion
      .saveApiKey(key)
      .then((next) => {
        // The command answers with the fresh status, so the user never waits for the poll.
        setStatus(next)
        setApiKeyDraft('')
      })
      .catch(() => {})
      .finally(() => {
        setApiKeyBusy(false)
      })
  }

  const forgetApiKey = (): void => {
    setApiKeyBusy(true)
    void window.api.codeCompletion
      .clearApiKey()
      .then((next) => {
        setStatus(next)
        setApiKeyDraft('')
      })
      .catch(() => {})
      .finally(() => {
        setApiKeyBusy(false)
      })
  }

  const title = t(
    'auto.components.settings.editor.CodeCompletionSection.7f223e3a62',
    'Next edit suggestions'
  )
  const description = t(
    'auto.components.settings.editor.CodeCompletionSection.8fdd3137a7',
    'Ask a model for the edits it expects to come next, then accept them with Tab.'
  )

  // The key warnings belong beside the key row, and exist only when there is something to warn about.
  const credentialWarning =
    status?.unreadable === 'sealed-elsewhere' ||
    status?.unreadable === 'unreadable' ||
    status?.protection === 'plaintext'

  return (
    <SearchableSetting
      id={GENERAL_SETTING_ANCHORS.codeCompletion}
      title={title}
      description={description}
      keywords={['completion', 'suggestions', 'next edit', 'autocomplete', 'ai', 'model', 'tab']}
      className="space-y-0"
    >
      <SettingsSwitchRow
        label={title}
        description={description}
        checked={completion.enabled}
        onChange={() => commit({ enabled: !completion.enabled })}
      />

      {status && !status.configured && !status.unreadable ? (
        <p role="status" className="py-2 text-xs text-muted-foreground">
          {t(
            'auto.components.settings.editor.CodeCompletionSection.4511c1769f',
            'Next edit suggestions stay off until you save an API key.'
          )}
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
            options={[
              {
                value: 'anthropic-messages',
                label: t(
                  'auto.components.settings.editor.CodeCompletionSection.93ed07a8a9',
                  'Anthropic Messages'
                )
              },
              {
                value: 'openai-chat',
                label: t(
                  'auto.components.settings.editor.CodeCompletionSection.ff49e75185',
                  'OpenAI Chat'
                )
              },
              {
                value: 'openai-completions-fim',
                label: t(
                  'auto.components.settings.editor.CodeCompletionSection.55e4686ab8',
                  'OpenAI FIM'
                )
              }
            ]}
          />
        }
      />

      <SettingsRow
        className="border-t border-border"
        label={t('auto.components.settings.editor.CodeCompletionSection.5c05e289b2', 'Base URL')}
        description={t(
          'auto.components.settings.editor.CodeCompletionSection.8ae1759bf4',
          'Where the completion request is sent. Leave it empty to use the provider default endpoint.'
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
          'auto.components.settings.editor.CodeCompletionSection.ac46b27154',
          'Which model the endpoint is asked to predict the next edits with.'
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

      <SettingsRow
        className="border-t border-border"
        label={
          <span className="flex items-center gap-2">
            {t('auto.components.settings.editor.CodeCompletionSection.13dcd09aa3', 'API key')}
            <SettingsBadge tone={status?.configured ? 'accent' : 'muted'}>
              {status?.configured
                ? t(
                    'auto.components.settings.editor.CodeCompletionSection.6cc3ca851a',
                    'Configured'
                  )
                : t(
                    'auto.components.settings.editor.CodeCompletionSection.3f93dfe0a5',
                    'Not configured'
                  )}
            </SettingsBadge>
          </span>
        }
        description={t(
          'auto.components.settings.editor.CodeCompletionSection.b6c02a6499',
          'The key sent to the endpoint. It is stored on this computer and never read back here.'
        )}
        control={
          <div className="flex items-center gap-2">
            <Input
              type="password"
              aria-label={t(
                'auto.components.settings.editor.CodeCompletionSection.13dcd09aa3',
                'API key'
              )}
              value={apiKeyDraft}
              onChange={(event) => setApiKeyDraft(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="w-56 text-xs"
            />
            <Button size="xs" onClick={saveApiKey} disabled={apiKeyBusy || !apiKeyDraft.trim()}>
              {t('auto.components.settings.editor.CodeCompletionSection.6ae350e2f4', 'Save key')}
            </Button>
            {status?.configured ? (
              <Button
                variant="ghost"
                size="xs"
                onClick={forgetApiKey}
                disabled={apiKeyBusy}
                className="text-muted-foreground hover:text-foreground"
              >
                {t(
                  'auto.components.settings.editor.CodeCompletionSection.431571ae23',
                  'Forget key'
                )}
              </Button>
            ) : null}
          </div>
        }
      />

      {credentialWarning ? (
        <div className="space-y-2 py-3">
          {status?.unreadable === 'sealed-elsewhere' ? (
            <p
              role="alert"
              className="rounded-md border border-status-warning-border bg-status-warning-background px-3 py-2 text-xs text-status-warning"
            >
              {t(
                'auto.components.settings.editor.CodeCompletionSection.585decfc3d',
                'Another Orca app on this computer saved the API key, and this one cannot read it. Enter the key again here.'
              )}
            </p>
          ) : null}
          {status?.unreadable === 'unreadable' ? (
            <p
              role="alert"
              className="rounded-md border border-status-warning-border bg-status-warning-background px-3 py-2 text-xs text-status-warning"
            >
              {t(
                'auto.components.settings.editor.CodeCompletionSection.4a609b9771',
                'The saved API key cannot be read on this computer. Enter the key again.'
              )}
            </p>
          ) : null}
          <UnsealedCredentialNotice
            protection={status?.protection ?? null}
            credentialName={t(
              'auto.components.settings.editor.CodeCompletionSection.13dcd09aa3',
              'API key'
            )}
          />
        </div>
      ) : null}

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
