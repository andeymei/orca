import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { toast } from 'sonner'
import type { CodeCompletionCredentialsStatus } from '../../../../../shared/code-completion/code-completion-credentials-status'
import { SettingsBadge, SettingsRow } from '../form-controls/SettingsFormControls'
import { UnsealedCredentialNotice } from '../../provider-accounts/UnsealedCredentialNotice'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { useTranslate, type Translate } from '@/i18n/use-translate'

/** The credential probe reads the sealed file from disk, so the status is polled instead of read per render. */
const CREDENTIAL_STATUS_POLL_MS = 5_000

type CredentialAction = 'save' | 'clear'

type CodeCompletionCredentialSettingProps = {
  /** The status the section holds; null means the probe has not answered or failed. */
  status: CodeCompletionCredentialsStatus | null
  onStatusChange: (status: CodeCompletionCredentialsStatus | null) => void
}

/** The bridge answers with the reason; the user needs the reason, not a generic failure. */
function failureReason(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function statusFailureMessage(t: Translate, reason: string): string {
  return t(
    'auto.components.settings.editor.CodeCompletionCredentialSetting.640461fa91',
    'Orca could not read the saved API key status: {{reason}}',
    { reason }
  )
}

function actionFailureMessage(t: Translate, action: CredentialAction, reason: string): string {
  return action === 'save'
    ? t(
        'auto.components.settings.editor.CodeCompletionCredentialSetting.ab6fc68dff',
        'The API key could not be saved: {{reason}}',
        { reason }
      )
    : t(
        'auto.components.settings.editor.CodeCompletionCredentialSetting.8e1a003071',
        'The API key could not be forgotten: {{reason}}',
        { reason }
      )
}

export function CodeCompletionCredentialSetting({
  status,
  onStatusChange
}: CodeCompletionCredentialSettingProps): React.JSX.Element {
  const t = useTranslate()
  const [statusError, setStatusError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<{
    action: CredentialAction
    reason: string
  } | null>(null)
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [apiKeyBusy, setApiKeyBusy] = useState(false)
  // A poll that keeps failing must not raise a toast on every tick.
  const reportedStatusErrorRef = useRef<string | null>(null)

  useEffect(() => {
    let disposed = false
    const readStatus = (): void => {
      void window.api.codeCompletion
        .getStatus()
        .then((next) => {
          if (disposed) {
            return
          }
          onStatusChange(next)
          setStatusError(null)
          reportedStatusErrorRef.current = null
        })
        .catch((reason: unknown) => {
          if (disposed) {
            return
          }
          // Why: a failed probe leaves the status unknown, so the section must not claim the key is missing.
          onStatusChange(null)
          const detail = failureReason(reason)
          setStatusError(detail)
          if (reportedStatusErrorRef.current !== detail) {
            reportedStatusErrorRef.current = detail
            toast.error(statusFailureMessage(t, detail))
          }
        })
    }
    readStatus()
    const timer = setInterval(readStatus, CREDENTIAL_STATUS_POLL_MS)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [onStatusChange, t])

  const saveApiKey = (): void => {
    const key = apiKeyDraft.trim()
    if (!key) {
      return
    }
    setApiKeyBusy(true)
    setActionError(null)
    void window.api.codeCompletion
      .saveApiKey(key)
      .then((next) => {
        // The command answers with the fresh status, so the user never waits for the poll.
        onStatusChange(next)
        setApiKeyDraft('')
      })
      .catch((reason: unknown) => {
        // The draft stays in the box, so the user can fix what the command rejected.
        const detail = failureReason(reason)
        setActionError({ action: 'save', reason: detail })
        toast.error(actionFailureMessage(t, 'save', detail))
      })
      .finally(() => {
        setApiKeyBusy(false)
      })
  }

  const forgetApiKey = (): void => {
    setApiKeyBusy(true)
    setActionError(null)
    void window.api.codeCompletion
      .clearApiKey()
      .then((next) => {
        onStatusChange(next)
        setApiKeyDraft('')
      })
      .catch((reason: unknown) => {
        const detail = failureReason(reason)
        setActionError({ action: 'clear', reason: detail })
        toast.error(actionFailureMessage(t, 'clear', detail))
      })
      .finally(() => {
        setApiKeyBusy(false)
      })
  }

  const apiKeyLabel = t(
    'auto.components.settings.editor.CodeCompletionCredentialSetting.671c48ed2f',
    'API key'
  )

  // Why: a key file that exists but cannot be read leaves the feature inert, so it is not "Configured".
  const badge: { tone: 'neutral' | 'accent' | 'muted'; label: string } | null =
    status === null
      ? null
      : status.unreadable
        ? {
            tone: 'neutral',
            label: t(
              'auto.components.settings.editor.CodeCompletionCredentialSetting.3545656faa',
              'Not readable'
            )
          }
        : status.configured
          ? {
              tone: 'accent',
              label: t(
                'auto.components.settings.editor.CodeCompletionCredentialSetting.72110c5f60',
                'Configured'
              )
            }
          : {
              tone: 'muted',
              label: t(
                'auto.components.settings.editor.CodeCompletionCredentialSetting.058d528ffc',
                'Not configured'
              )
            }

  return (
    <>
      <SettingsRow
        className="border-t border-border"
        label={
          <span className="flex items-center gap-2">
            {apiKeyLabel}
            {/* The badge must not state a fact the section does not know yet. */}
            {badge ? <SettingsBadge tone={badge.tone}>{badge.label}</SettingsBadge> : null}
          </span>
        }
        description={t(
          'auto.components.settings.editor.CodeCompletionCredentialSetting.9655d8987a',
          'The key sent to the endpoint. It is stored on this computer and never read back here.'
        )}
        control={
          <div className="flex items-center gap-2">
            <Input
              type="password"
              aria-label={apiKeyLabel}
              value={apiKeyDraft}
              onChange={(event) => setApiKeyDraft(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              variant="code"
              className="w-56"
            />
            <Button size="xs" onClick={saveApiKey} disabled={apiKeyBusy || !apiKeyDraft.trim()}>
              {t(
                'auto.components.settings.editor.CodeCompletionCredentialSetting.497d9c6669',
                'Save key'
              )}
            </Button>
            {/* A key the user can see is a key the user can clear, so the button stays when the status is unknown. */}
            {status === null || status.configured ? (
              <Button variant="ghost" size="xs" onClick={forgetApiKey} disabled={apiKeyBusy}>
                {t(
                  'auto.components.settings.editor.CodeCompletionCredentialSetting.4e5566955b',
                  'Forget key'
                )}
              </Button>
            ) : null}
          </div>
        }
      />

      {statusError || actionError || status?.unreadable || status?.protection === 'plaintext' ? (
        <div className="space-y-2 py-3">
          {statusError ? (
            <p
              role="alert"
              className="rounded-md border border-status-warning-border bg-status-warning-background px-3 py-2 text-xs text-status-warning"
            >
              {statusFailureMessage(t, statusError)}
            </p>
          ) : null}
          {actionError ? (
            <p
              role="alert"
              className="rounded-md border border-status-warning-border bg-status-warning-background px-3 py-2 text-xs text-status-warning"
            >
              {actionFailureMessage(t, actionError.action, actionError.reason)}
            </p>
          ) : null}
          {status?.unreadable === 'sealed-elsewhere' ? (
            <p
              role="alert"
              className="rounded-md border border-status-warning-border bg-status-warning-background px-3 py-2 text-xs text-status-warning"
            >
              {t(
                'auto.components.settings.editor.CodeCompletionCredentialSetting.bae7fac98c',
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
                'auto.components.settings.editor.CodeCompletionCredentialSetting.5cd84c92f7',
                'The saved API key cannot be read on this computer. Enter the key again.'
              )}
            </p>
          ) : null}
          <UnsealedCredentialNotice
            protection={status?.protection ?? null}
            credentialName={apiKeyLabel}
          />
        </div>
      ) : null}
    </>
  )
}
