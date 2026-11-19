// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n/i18n'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import { getDefaultSettings } from '../../../../../shared/constants'
import type { CodeCompletionCredentialsStatus } from '../../../../../shared/code-completion/code-completion-credentials-status'
import { TooltipProvider } from '../../ui/tooltip'
import { CodeCompletionSection } from './CodeCompletionSection'

const statuses = vi.hoisted(() => ({
  current: { configured: false, protection: null } as CodeCompletionCredentialsStatus
}))

function statusFixture(overrides: Partial<CodeCompletionCredentialsStatus> = {}) {
  return { configured: false, protection: null, ...overrides }
}

type ApiRecorder = {
  getStatus: ReturnType<typeof vi.fn>
  saveApiKey: ReturnType<typeof vi.fn>
  clearApiKey: ReturnType<typeof vi.fn>
}

function installApi(overrides: Partial<ApiRecorder> = {}): ApiRecorder {
  const api: ApiRecorder = {
    getStatus: vi.fn(() => Promise.resolve(statuses.current)),
    saveApiKey: vi.fn(() => Promise.resolve(statuses.current)),
    clearApiKey: vi.fn(() => Promise.resolve(statuses.current)),
    ...overrides
  }
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { codeCompletion: api }
  })
  return api
}

function renderSection(overrides: Partial<GlobalSettings['codeCompletion']> = {}) {
  const defaults = getDefaultSettings('/tmp')
  const settings = {
    ...defaults,
    codeCompletion: { ...defaults.codeCompletion, ...overrides }
  } as GlobalSettings
  const updateSettings = vi.fn()
  render(
    <TooltipProvider>
      <CodeCompletionSection settings={settings} updateSettings={updateSettings} />
    </TooltipProvider>
  )
  return { updateSettings }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  statuses.current = statusFixture()
  installApi()
})

afterEach(cleanup)

describe('CodeCompletionSection', () => {
  it('tells the user the feature is off until an API key is saved', async () => {
    renderSection()

    expect(
      await screen.findByText('Next edit suggestions stay off until you save an API key.')
    ).toBeInTheDocument()
    expect(screen.getByText('Not configured')).toBeInTheDocument()
  })

  it('writes the whole block when the master switch flips', async () => {
    const { updateSettings } = renderSection()

    fireEvent.click(screen.getByRole('switch', { name: 'Next edit suggestions' }))

    expect(updateSettings).toHaveBeenCalledTimes(1)
    const written = updateSettings.mock.calls[0][0].codeCompletion
    expect(written.enabled).toBe(false)
    expect(written.protocol).toBe('anthropic-messages')
    expect(written.model).toBe('')
    expect(written.enabledExtensions.length).toBeGreaterThan(0)
  })

  it('writes the backend id, not the label, when the protocol changes', async () => {
    const { updateSettings } = renderSection()

    fireEvent.click(screen.getByRole('radio', { name: 'OpenAI FIM' }))

    expect(updateSettings.mock.calls[0][0].codeCompletion.protocol).toBe('openai-completions-fim')
  })

  it('keeps the earlier change when a second write lands before the first echo', async () => {
    const { updateSettings } = renderSection()

    fireEvent.click(screen.getByRole('switch', { name: 'Next edit suggestions' }))
    fireEvent.click(screen.getByRole('radio', { name: 'OpenAI FIM' }))

    expect(updateSettings).toHaveBeenCalledTimes(2)
    // The second write carries the first change, so the normalizer cannot reset it.
    expect(updateSettings.mock.calls[1][0].codeCompletion.enabled).toBe(false)
    expect(updateSettings.mock.calls[1][0].codeCompletion.protocol).toBe('openai-completions-fim')
  })

  it('clears the key input once the save succeeds', async () => {
    const getStatus = vi.fn(() => Promise.resolve(statuses.current))
    const saveApiKey = vi.fn(() =>
      Promise.resolve(statusFixture({ configured: true, protection: 'sealed' }))
    )
    installApi({ getStatus, saveApiKey })
    renderSection()

    const keyInput = screen.getByLabelText('API key')
    fireEvent.change(keyInput, { target: { value: 'sk-test-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }))

    await waitFor(() => expect(saveApiKey).toHaveBeenCalledWith('sk-test-123'))
    await waitFor(() => expect(keyInput).toHaveValue(''))
    expect(keyInput.getAttribute('type')).toBe('password')
  })

  it('says the key must be entered again when the other Orca app sealed it', async () => {
    statuses.current = statusFixture({ configured: true, unreadable: 'sealed-elsewhere' })
    renderSection()

    expect(
      await screen.findByText(
        'Another Orca app on this computer saved the API key, and this one cannot read it. Enter the key again here.'
      )
    ).toBeInTheDocument()
  })

  it('says the key should be re-entered when the saved file cannot be read', async () => {
    statuses.current = statusFixture({ configured: true, unreadable: 'unreadable' })
    renderSection()

    expect(
      await screen.findByText(
        'The saved API key cannot be read on this computer. Enter the key again.'
      )
    ).toBeInTheDocument()
  })

  it('warns when the key sits on disk unencrypted', async () => {
    statuses.current = statusFixture({ configured: true, protection: 'plaintext' })
    renderSection()

    expect(await screen.findByRole('alert')).toHaveTextContent('stored unencrypted')
  })
})
