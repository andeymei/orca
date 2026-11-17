// @vitest-environment happy-dom
import type * as I18n from '@/i18n/i18n'
import { act, cleanup, createEvent, fireEvent, render } from '@testing-library/react'
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
import { makeWorktree } from '@/store/slices/worktrees/worktree.test-fixture'
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
  { id: 'bbbb2222', sessionId: 's2', name: 'beta', cwd: '/w', state: 'working' },
  { id: 'ffff6666', sessionId: 's6', name: 'phi', cwd: '/w-feature', state: 'working' }
]
const DETAILS: Record<string, ClaudeBackgroundAgentDetail> = {
  aaaa1111: { detail: 'running the tests', needs: null, updatedAt: 1 },
  bbbb2222: { detail: 'waiting on a review', needs: null, updatedAt: 2 },
  ffff6666: { detail: 'working in the sibling workspace', needs: null, updatedAt: 6 }
}

/** The workspace the panel answers for; its directory is where its own agents ran. */
const WORKSPACE_ID = 'repo1::/w'
/** A sibling workspace of the same repository: its agents are not this workspace's agents. */
const SIBLING_WORKSPACE_ID = 'repo1::/w-feature'

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
    activeWorktreeId: WORKSPACE_ID,
    activeWorkspaceExecutionHostId: null,
    worktreesByRepo: {
      repo1: [
        makeWorktree({ id: WORKSPACE_ID, repoId: 'repo1', path: '/w' }),
        makeWorktree({ id: SIBLING_WORKSPACE_ID, repoId: 'repo1', path: '/w-feature' })
      ]
    }
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

it('asks for the delete to be confirmed twice, because deleting an agent takes its worktree', async () => {
  const remove = vi.fn(async (): Promise<ClaudeBackgroundAgentCommandResult> => ({
    ok: true,
    id: 'dddd4444'
  }))
  const stop = vi.fn(async (): Promise<ClaudeBackgroundAgentCommandResult> => ({
    ok: true,
    id: 'dddd4444'
  }))
  const finished: ClaudeBackgroundAgent[] = [
    { id: 'dddd4444', sessionId: 's4', name: 'delta', cwd: '/w', state: 'done' }
  ]
  installApi({
    remove,
    stop,
    list: vi.fn(async (): Promise<ClaudeBackgroundAgentListResult> => ({
      status: 'ready',
      agents: finished,
      details: {},
      message: null
    })),
    readDetails: vi.fn(async (): Promise<Record<string, ClaudeBackgroundAgentDetail>> => ({}))
  })
  useAppStore.setState({ backgroundAgentsAgents: finished })
  const view = await renderScreen()
  const root = view.getByTestId('background-agents-list')
  await press(root, 'x', { ctrlKey: true })
  expect(view.getByText(/ctrl\+x again to delete/)).toBeTruthy()
  expect(view.getByText(/Deleting an agent also deletes its worktree/)).toBeTruthy()
  expect(remove).not.toHaveBeenCalled()
  await press(root, 'x', { ctrlKey: true })
  expect(remove).toHaveBeenCalledTimes(1)
  expect(remove).toHaveBeenCalledWith({ id: 'dddd4444' })
  // A finished agent is deleted, not stopped.
  expect(stop).not.toHaveBeenCalled()
})

it('clears the composer instead of cancelling the dispatch when Escape is pressed', async () => {
  const pending = Promise.withResolvers<ClaudeBackgroundAgentCommandResult>()
  const cancelDispatch = vi.fn(async (): Promise<void> => {})
  installApi({ dispatch: vi.fn(() => pending.promise), cancelDispatch })
  const view = await renderScreen()
  await type(view, 'do the thing')
  await press(view.getByTestId('background-agents-list'), 'Enter')
  const composer = view.getByLabelText('New background agent')
  if (!(composer instanceof HTMLInputElement)) {
    throw new Error('the composer is not a text input')
  }
  await press(composer, 'Escape')
  expect(composer.value).toBe('')
  expect(cancelDispatch).not.toHaveBeenCalled()
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

it('keeps this machine out of scope when the workspace runs elsewhere', async () => {
  useAppStore.setState({
    activeWorktreeId: 'wt-remote',
    activeWorkspaceExecutionHostId: 'ssh:box'
  })
  const view = await renderScreen()
  expect(view.getByTestId('background-agents-local-only-notice')).toBeTruthy()
  // The workspace's own directory is on the other host, so this machine's agents are out of scope.
  expect(view.queryAllByTestId('background-agent-row')).toHaveLength(0)
})

it('leaves the agents of the sibling workspace out of the rows and the counts', async () => {
  const view = await renderScreen()
  const rows = view.getAllByTestId('background-agent-row')
  expect(rows).toHaveLength(2)
  expect(rows.map((row) => row.getAttribute('data-agent-id'))).not.toContain('ffff6666')
  expect(view.getByText('0 awaiting input · 2 working · 0 completed')).toBeTruthy()
})

it('swaps the roster when the user switches workspace', async () => {
  const view = await renderScreen()
  expect(view.getAllByTestId('background-agent-row')).toHaveLength(2)
  expect(view.getByText('0 awaiting input · 2 working · 0 completed')).toBeTruthy()

  await act(async () => {
    useAppStore.setState({ activeWorktreeId: SIBLING_WORKSPACE_ID })
  })

  const rows = view.getAllByTestId('background-agent-row')
  expect(rows).toHaveLength(1)
  expect(rows[0].getAttribute('data-agent-id')).toBe('ffff6666')
  expect(view.getByText('0 awaiting input · 1 working · 0 completed')).toBeTruthy()
})

it('leaves the agents of other workspaces out of the rows and the counts', async () => {
  const mixed: ClaudeBackgroundAgent[] = [
    ...ROSTER,
    { id: 'eeee5555', sessionId: 's5', name: 'epsilon', cwd: '/other', state: 'working' }
  ]
  installApi({
    list: vi.fn(async (): Promise<ClaudeBackgroundAgentListResult> => ({
      status: 'ready',
      agents: mixed,
      details: DETAILS,
      message: null
    })),
    readDetails: vi.fn(async (): Promise<Record<string, ClaudeBackgroundAgentDetail>> => DETAILS)
  })
  useAppStore.setState({ backgroundAgentsAgents: mixed })
  const view = await renderScreen()
  const rows = view.getAllByTestId('background-agent-row')
  expect(rows).toHaveLength(2)
  expect(rows.map((row) => row.getAttribute('data-agent-id'))).not.toContain('eeee5555')
  expect(view.getByText('0 awaiting input · 2 working · 0 completed')).toBeTruthy()
})

it('says the project has no background agents found when the workspace has none', async () => {
  installApi({
    list: vi.fn(async (): Promise<ClaudeBackgroundAgentListResult> => ({
      status: 'ready',
      agents: [],
      details: {},
      message: null
    })),
    readDetails: vi.fn(async (): Promise<Record<string, ClaudeBackgroundAgentDetail>> => ({}))
  })
  useAppStore.setState({ backgroundAgentsAgents: [] })
  const view = await renderScreen()
  expect(view.getByText('No background agents found for this project')).toBeTruthy()
})

it('asks for a project when no workspace is open', async () => {
  installApi({
    list: vi.fn(async (): Promise<ClaudeBackgroundAgentListResult> => ({
      status: 'ready',
      agents: [],
      details: {},
      message: null
    })),
    readDetails: vi.fn(async (): Promise<Record<string, ClaudeBackgroundAgentDetail>> => ({}))
  })
  useAppStore.setState({ backgroundAgentsAgents: [], activeWorktreeId: null })
  const view = await renderScreen()
  expect(view.getByText('Open a project to see its background agents')).toBeTruthy()
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

it('keeps the rows out of the tab order', async () => {
  const view = await renderScreen()
  for (const row of view.getAllByTestId('background-agent-row')) {
    expect(row.getAttribute('tabindex')).toBe('-1')
  }
})

it('keeps the panel keys working when a row holds the focus', async () => {
  const stop = vi.fn(async (): Promise<ClaudeBackgroundAgentCommandResult> => ({
    ok: true,
    id: 'bbbb2222'
  }))
  installApi({ stop })
  const view = await renderScreen()
  const row = view.getAllByTestId('background-agent-row')[1]
  row.focus()
  expect(document.activeElement).toBe(row)
  await press(row, 'ArrowDown')
  const rows = view.getAllByTestId('background-agent-row')
  expect(rows[1].getAttribute('data-selected')).toBe('true')
  await press(row, 'x', { ctrlKey: true })
  expect(view.getByText('ctrl+x again to stop')).toBeTruthy()
  expect(stop).not.toHaveBeenCalled()
  await press(row, 'Enter')
  expect(useAppStore.getState().backgroundAgentsScreen).toEqual({
    kind: 'agent',
    agentId: 'bbbb2222'
  })
})

it('opens the selected row on Enter, not the focused one', async () => {
  const view = await renderScreen()
  const rows = view.getAllByTestId('background-agent-row')
  rows[1].focus()
  expect(document.activeElement).toBe(rows[1])
  expect(rows[0].getAttribute('data-selected')).toBe('true')
  await press(rows[1], 'Enter')
  expect(useAppStore.getState().backgroundAgentsScreen).toEqual({
    kind: 'agent',
    agentId: 'aaaa1111'
  })
})

it('opens the selected row on Space, not the focused one', async () => {
  const view = await renderScreen()
  const rows = view.getAllByTestId('background-agent-row')
  rows[1].focus()
  expect(document.activeElement).toBe(rows[1])
  expect(rows[0].getAttribute('data-selected')).toBe('true')
  const space = createEvent.keyDown(rows[1], { key: ' ' })
  await act(async () => {
    fireEvent(rows[1], space)
  })
  // The button's own activation would open the focused row, so it has to be stopped.
  expect(space.defaultPrevented).toBe(true)
  expect(useAppStore.getState().backgroundAgentsScreen).toEqual({
    kind: 'agent',
    agentId: 'aaaa1111'
  })
})

it('lets the native cut win when the composer has a selection', async () => {
  const stop = vi.fn(async (): Promise<ClaudeBackgroundAgentCommandResult> => ({
    ok: true,
    id: 'bbbb2222'
  }))
  installApi({ stop })
  const view = await renderScreen()
  const composer = view.getByLabelText('New background agent')
  if (!(composer instanceof HTMLInputElement)) {
    throw new Error('the composer is not a text input')
  }
  await type(view, 'do the thing')
  composer.setSelectionRange(0, 3)
  const cut = createEvent.keyDown(composer, { key: 'x', ctrlKey: true })
  fireEvent(composer, cut)
  expect(cut.defaultPrevented).toBe(false)
  expect(stop).not.toHaveBeenCalled()
})
