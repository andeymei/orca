// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { i18n } from '@/i18n/i18n'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import { getDefaultSettings } from '../../../../../shared/constants'
import type { CodeCompletionCredentialsStatus } from '../../../../../shared/code-completion/code-completion-credentials-status'
import { TooltipProvider } from '../../ui/tooltip'
import { CodeCompletionSection } from './CodeCompletionSection'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))

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
    codeCompletion: {
      ...defaults.codeCompletion,
      // The endpoint and the model are set, so the readiness line names the key alone.
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4',
      ...overrides
    }
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
  vi.clearAllMocks()
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

  it('names the endpoint and the model the runtime also needs', async () => {
    renderSection({ baseUrl: '', model: '' })

    const readiness = await screen.findByText(/stay off until/)
    expect(readiness).toHaveTextContent('save an API key')
    expect(readiness).toHaveTextContent('set the endpoint')
    expect(readiness).toHaveTextContent('choose a model')
  })

  it('writes the whole block when the master switch flips', async () => {
    const { updateSettings } = renderSection()

    fireEvent.click(screen.getByRole('switch', { name: 'Next edit suggestions' }))

    expect(updateSettings).toHaveBeenCalledTimes(1)
    const written = updateSettings.mock.calls[0][0].codeCompletion
    expect(written.enabled).toBe(false)
    expect(written.protocol).toBe('anthropic-messages')
    expect(written.model).toBe('claude-sonnet-4')
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

  it('stores the extension list without dots and in lower case', async () => {
    const { updateSettings } = renderSection()

    const extensionInput = screen.getByLabelText('Enabled extensions')
    fireEvent.change(extensionInput, { target: { value: '.TS, tsx ,' } })
    fireEvent.blur(extensionInput)

    await waitFor(() => expect(updateSettings).toHaveBeenCalled())
    expect(updateSettings.mock.calls.at(-1)?.[0].codeCompletion.enabledExtensions).toEqual([
      'ts',
      'tsx'
    ])
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

  it('never writes the API key into the settings', async () => {
    const { updateSettings } = renderSection()

    fireEvent.click(screen.getByRole('switch', { name: 'Next edit suggestions' }))
    const keyInput = screen.getByLabelText('API key')
    fireEvent.change(keyInput, { target: { value: 'sk-test-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }))

    await waitFor(() => expect(keyInput).toHaveValue(''))
    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(updateSettings.mock.calls)).not.toContain('sk-test-123')
  })

  it('does not claim the key is missing before the first probe answers', () => {
    installApi({ getStatus: vi.fn(() => new Promise<CodeCompletionCredentialsStatus>(() => {})) })
    renderSection()

    expect(screen.queryByText('Not configured')).not.toBeInTheDocument()
  })

  it('reports a failed status probe instead of claiming the key is missing', async () => {
    installApi({
      getStatus: vi.fn(() => Promise.reject(new Error('the key file is gone')))
    })
    renderSection()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Orca could not read the saved API key status'
    )
    expect(screen.queryByText('Not configured')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Next edit suggestions stay off until you save an API key.')
    ).not.toBeInTheDocument()
    expect(toast.error).toHaveBeenCalled()
  })

  it('reports a failed key save and keeps the draft', async () => {
    installApi({
      saveApiKey: vi.fn(() =>
        Promise.reject(new Error('Code completion API key must be a single line'))
      )
    })
    renderSection()

    const keyInput = screen.getByLabelText('API key')
    fireEvent.change(keyInput, { target: { value: 'sk-first' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The API key could not be saved')
    // The reason travels with the message, so the user knows what to change.
    expect(alert).toHaveTextContent('must be a single line')
    // The draft stays in the box, so the user can fix it.
    expect(keyInput).toHaveValue('sk-first')
    expect(toast.error).toHaveBeenCalled()
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
