// @vitest-environment happy-dom
import type * as I18n from '@/i18n/i18n'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type { ClaudeAgentsApi } from '../../../../preload/api/claude-agents-api'
import type {
  ClaudeBackgroundAgent,
  ClaudeBackgroundAgentCommandResult,
  ClaudeBackgroundAgentDetail,
  ClaudeBackgroundAgentListResult
} from '../../../../shared/claude-background-agents'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '../../store/index'
import BackgroundAgentListScreen from './BackgroundAgentListScreen'

vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof I18n>()),
  // Why: the placeholders have to be filled in, or the counts and the id never show up.
  translate: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    values
      ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ''))
      : fallback
}))
vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))

const ROSTER: ClaudeBackgroundAgent[] = [
  { id: 'aaaa1111', sessionId: 's1', name: 'alpha', cwd: '/w', state: 'working' },
  { id: 'bbbb2222', sessionId: 's2', name: 'beta', cwd: '/w', state: 'working' }
]
const DETAILS: Record<string, ClaudeBackgroundAgentDetail> = {
  aaaa1111: { detail: 'running the tests', needs: null, updatedAt: 1 },
  bbbb2222: { detail: 'waiting on a review', needs: null, updatedAt: 2 }
}

function installApi(overrides: Partial<ClaudeAgentsApi> = {}): void {
  vi.stubGlobal('api', {
    claudeAgents: {
      list: vi.fn(async (): Promise<ClaudeBackgroundAgentListResult> => ({
        status: 'ready',
        agents: ROSTER,
        details: DETAILS,
        message: null
      })),
      readDetails: vi.fn(async (): Promise<Record<string, ClaudeBackgroundAgentDetail>> => DETAILS),
      dispatch: vi.fn(async (): Promise<ClaudeBackgroundAgentCommandResult> => ({
        ok: true,
        id: 'cccc3333'
      })),
      cancelDispatch: vi.fn(async (): Promise<void> => {}),
      stop: vi.fn(async (): Promise<ClaudeBackgroundAgentCommandResult> => ({
        ok: true,
        id: 'bbbb2222'
      })),
      remove: vi.fn(async (): Promise<ClaudeBackgroundAgentCommandResult> => ({
        ok: true,
        id: 'bbbb2222'
      })),
      ...overrides
    }
  })
}

async function renderScreen(): Promise<ReturnType<typeof render>> {
  let view: ReturnType<typeof render> | null = null
  await act(async () => {
    view = render(
      <TooltipProvider>
        <BackgroundAgentListScreen />
      </TooltipProvider>
    )
  })
  if (!view) {
    throw new Error('the screen did not render')
  }
  return view
}

async function press(element: Element, key: string, init?: Record<string, unknown>): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(element, { key, ...init })
  })
}

async function type(view: ReturnType<typeof render>, prompt: string): Promise<void> {
  const composer = view.getByLabelText('New background agent')
  await act(async () => {
    fireEvent.change(composer, { target: { value: prompt } })
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  installApi()
  useAppStore.setState({
    backgroundAgentsScreen: { kind: 'list' },
    backgroundAgentsStatus: 'ready',
    backgroundAgentsMessage: null,
    backgroundAgentsAgents: ROSTER,
    backgroundAgentsDetails: DETAILS,
    backgroundAgentsDispatch: null,
    activeWorktreeId: null,
    activeWorkspaceExecutionHostId: null,
    worktreesByRepo: {}
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it('moves the selection with the arrow keys', async () => {
  const view = await renderScreen()
  await press(view.getByTestId('background-agents-list'), 'ArrowDown')
  const rows = view.getAllByTestId('background-agent-row')
  expect(rows[0].getAttribute('data-selected')).toBeNull()
  expect(rows[1].getAttribute('data-selected')).toBe('true')
})

it('puts the caret in the composer when the screen opens', async () => {
  const view = await renderScreen()
  expect(document.activeElement).toBe(view.getByLabelText('New background agent'))
})

it('moves the selection with the arrow keys from the composer', async () => {
  const view = await renderScreen()
  const composer = view.getByLabelText('New background agent')
  expect(document.activeElement).toBe(composer)
  await press(composer, 'ArrowDown')
  const rows = view.getAllByTestId('background-agent-row')
  expect(rows[0].getAttribute('data-selected')).toBeNull()
  expect(rows[1].getAttribute('data-selected')).toBe('true')
})

it('arms the stop with ctrl+x from the composer', async () => {
  const stop = vi.fn(async (): Promise<ClaudeBackgroundAgentCommandResult> => ({
    ok: true,
    id: 'bbbb2222'
  }))
  installApi({ stop })
  const view = await renderScreen()
  const composer = view.getByLabelText('New background agent')
  await press(composer, 'ArrowDown')
  await press(composer, 'x', { ctrlKey: true })
  expect(view.getByText('ctrl+x again to stop')).toBeTruthy()
  expect(stop).not.toHaveBeenCalled()
})

it('enters the selected agent on Enter', async () => {
  const view = await renderScreen()
  const root = view.getByTestId('background-agents-list')
  await press(root, 'ArrowDown')
  await press(root, 'Enter')
  expect(useAppStore.getState().backgroundAgentsScreen).toEqual({
    kind: 'agent',
    agentId: 'bbbb2222'
  })
})

it('asks for the stop to be confirmed twice', async () => {
  const stop = vi.fn(async (): Promise<ClaudeBackgroundAgentCommandResult> => ({
    ok: true,
    id: 'bbbb2222'
  }))
  installApi({ stop })
  const view = await renderScreen()
  const root = view.getByTestId('background-agents-list')
  await press(root, 'ArrowDown')
  await press(root, 'x', { ctrlKey: true })
  expect(view.getByText('ctrl+x again to stop')).toBeTruthy()
  expect(stop).not.toHaveBeenCalled()
  await press(root, 'x', { ctrlKey: true })
  expect(stop).toHaveBeenCalledTimes(1)
  expect(stop).toHaveBeenCalledWith({ id: 'bbbb2222' })
})

it('dispatches the composed prompt', async () => {
  const dispatch = vi.fn(async (): Promise<ClaudeBackgroundAgentCommandResult> => ({
    ok: true,
    id: 'cccc3333'
  }))
  installApi({ dispatch })
  const view = await renderScreen()
  await type(view, 'do the thing')
  await press(view.getByTestId('background-agents-list'), 'Enter')
  expect(dispatch).toHaveBeenCalledTimes(1)
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'do the thing' }))
})

it('counts the agents in the header', async () => {
  const view = await renderScreen()
  expect(view.getByText('0 awaiting input · 2 working · 0 completed')).toBeTruthy()
})

it('does not advertise a search the panel does not have', async () => {
  const view = await renderScreen()
  expect(view.getByText('↑↓ select · enter enter · ctrl+x stop · / task')).toBeTruthy()
})

it('shows what a blocked agent is asking', async () => {
  const blocked: ClaudeBackgroundAgent[] = [
    { id: 'cccc3333', sessionId: 's3', name: 'gamma', cwd: '/w', state: 'blocked' }
  ]
  const blockedDetails: Record<string, ClaudeBackgroundAgentDetail> = {
    cccc3333: { detail: 'running the tests', needs: 'which database should I use?', updatedAt: 3 }
  }
  installApi({
    list: vi.fn(async (): Promise<ClaudeBackgroundAgentListResult> => ({
      status: 'ready',
      agents: blocked,
      details: blockedDetails,
      message: null
    })),
    readDetails: vi.fn(
      async (): Promise<Record<string, ClaudeBackgroundAgentDetail>> => blockedDetails
    )
  })
  const view = await renderScreen()
  await act(async () => {})
  const row = view.getByTestId('background-agent-row')
  expect(row.textContent).toContain('which database should I use?')
  expect(row.textContent).not.toContain('running the tests')
})

it('shows an opening row while the dispatch is on its way', async () => {
  const pending = Promise.withResolvers<ClaudeBackgroundAgentCommandResult>()
  installApi({ dispatch: vi.fn(() => pending.promise) })
  const view = await renderScreen()
  await type(view, 'do the thing')
  await press(view.getByTestId('background-agents-list'), 'Enter')
  expect(view.getByTestId('background-agent-dispatch-row').textContent).toContain(
    'opening… · esc to cancel'
  )
})

it('marks the dispatch as cancelling when Escape is pressed', async () => {
  const pending = Promise.withResolvers<ClaudeBackgroundAgentCommandResult>()
  installApi({ dispatch: vi.fn(() => pending.promise) })
  const view = await renderScreen()
  await type(view, 'do the thing')
  await press(view.getByTestId('background-agents-list'), 'Enter')
  await press(view.getByTestId('background-agent-dispatch-row'), 'Escape')
  expect(view.getByTestId('background-agent-dispatch-row').textContent).toContain('cancelling…')
})

it('cancels the opening dispatch when Escape is pressed', async () => {
  const pending = Promise.withResolvers<ClaudeBackgroundAgentCommandResult>()
  const cancelDispatch = vi.fn(async (): Promise<void> => {})
  installApi({ dispatch: vi.fn(() => pending.promise), cancelDispatch })
  const view = await renderScreen()
  await type(view, 'do the thing')
  await press(view.getByTestId('background-agents-list'), 'Enter')
  await press(view.getByTestId('background-agent-dispatch-row'), 'Escape')
  expect(cancelDispatch).toHaveBeenCalledTimes(1)
  // The abort only delivers the signal; the row waits for the dispatch to settle.
  expect(view.queryByTestId('background-agent-dispatch-row')).not.toBeNull()
  await act(async () => {
    pending.resolve({ ok: false, message: 'the dispatch was cancelled' })
    await pending.promise
  })
  expect(view.queryByTestId('background-agent-dispatch-row')).toBeNull()
})

it('drops a cancelled dispatch when the panel was remounted', async () => {
  const pending = Promise.withResolvers<ClaudeBackgroundAgentCommandResult>()
  const cancelDispatch = vi.fn(async (): Promise<void> => {})
  installApi({ dispatch: vi.fn(() => pending.promise), cancelDispatch })
  const first = await renderScreen()
  await type(first, 'do the thing')
  await press(first.getByTestId('background-agents-list'), 'Enter')
  // The panel unmounts when the user switches sidebar tabs; the new instance knows nothing.
  first.unmount()
  const second = await renderScreen()
  await press(second.getByTestId('background-agent-dispatch-row'), 'Escape')
  expect(cancelDispatch).toHaveBeenCalledTimes(1)
  await act(async () => {
    pending.resolve({ ok: false, message: 'the dispatch was cancelled' })
    await pending.promise
  })
  expect(second.queryByTestId('background-agent-dispatch-row')).toBeNull()
  expect(toast.error).not.toHaveBeenCalled()
})

it('says so when the dispatch fails', async () => {
  installApi({
    dispatch: vi.fn(async (): Promise<ClaudeBackgroundAgentCommandResult> => ({
      ok: false,
      message: 'the CLI refused the prompt'
    }))
  })
  const view = await renderScreen()
  await type(view, 'do the thing')
  await press(view.getByTestId('background-agents-list'), 'Enter')
  expect(view.getByTestId('background-agent-dispatch-row').textContent).toContain(
    'the CLI refused the prompt'
  )
  expect(toast.error).toHaveBeenCalledTimes(1)
  expect(toast.error).toHaveBeenCalledWith('the CLI refused the prompt')
})

it('says the agent could not be started when the dispatch failed without a reason', async () => {
  useAppStore.getState().publishBackgroundAgentsDispatch({
    state: 'failed',
    agentId: null,
    message: null
  })
  const view = await renderScreen()
  expect(view.getByTestId('background-agent-dispatch-row').textContent).toContain(
    'The agent could not be started'
  )
})

it('says the panel lists this machine when the workspace runs elsewhere', async () => {
  useAppStore.setState({
    activeWorktreeId: 'wt-remote',
    activeWorkspaceExecutionHostId: 'ssh:box'
  })
  const view = await renderScreen()
  expect(view.getByTestId('background-agents-local-only-notice')).toBeTruthy()
  expect(view.getAllByTestId('background-agent-row')).toHaveLength(2)
})

it('refuses a second dispatch while one is on its way', async () => {
  const pending = Promise.withResolvers<ClaudeBackgroundAgentCommandResult>()
  const dispatch = vi.fn(() => pending.promise)
  installApi({ dispatch })
  const view = await renderScreen()
  await type(view, 'do the thing')
  await press(view.getByTestId('background-agents-list'), 'Enter')
  await press(view.getByTestId('background-agents-list'), 'Enter')
  expect(dispatch).toHaveBeenCalledTimes(1)
})

it('says the agent started when the cancel lost the race', async () => {
  const pending = Promise.withResolvers<ClaudeBackgroundAgentCommandResult>()
  installApi({ dispatch: vi.fn(() => pending.promise) })
  const view = await renderScreen()
  await type(view, 'do the thing')
  await press(view.getByTestId('background-agents-list'), 'Enter')
  await press(view.getByTestId('background-agent-dispatch-row'), 'Escape')
  await act(async () => {
    pending.resolve({ ok: true, id: 'dddd4444' })
    await pending.promise
  })
  expect(view.getByTestId('background-agent-dispatch-row').textContent).toContain(
    'started · dddd4444'
  )
  await act(async () => {
    vi.advanceTimersByTime(2000)
  })
  expect(view.queryByTestId('background-agent-dispatch-row')).toBeNull()
})

it('keeps a newer dispatch row when the started row expires', async () => {
  const first = Promise.withResolvers<ClaudeBackgroundAgentCommandResult>()
  const second = Promise.withResolvers<ClaudeBackgroundAgentCommandResult>()
  const dispatch = vi
    .fn()
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise)
  installApi({ dispatch })
  const view = await renderScreen()
  await type(view, 'do the thing')
  await press(view.getByTestId('background-agents-list'), 'Enter')
  await press(view.getByTestId('background-agent-dispatch-row'), 'Escape')
  await act(async () => {
    first.resolve({ ok: true, id: 'dddd4444' })
    await first.promise
  })
  await type(view, 'another thing')
  await press(view.getByTestId('background-agents-list'), 'Enter')
  expect(view.getByTestId('background-agent-dispatch-row').textContent).toContain(
    'opening… · esc to cancel'
  )
  await act(async () => {
    vi.advanceTimersByTime(2000)
  })
  // The expired "started" row must not take the new dispatch's row with it.
  expect(view.getByTestId('background-agent-dispatch-row').textContent).toContain(
    'opening… · esc to cancel'
  )
})

it('focuses the composer with the slash key', async () => {
  const view = await renderScreen()
  const root = view.getByTestId('background-agents-list')
  root.focus()
  expect(document.activeElement).toBe(root)
  await press(root, '/')
  expect(document.activeElement).toBe(view.getByLabelText('New background agent'))
})
