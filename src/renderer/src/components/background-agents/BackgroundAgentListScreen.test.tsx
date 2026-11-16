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
import type { Worktree } from '../../../../shared/worktree/types'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '../../store/index'
import BackgroundAgentListScreen from './BackgroundAgentListScreen'

vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof I18n>()),
  translate: (_key: string, fallback: string) => fallback
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

function remoteWorktree(): Worktree {
  return {
    id: 'wt-remote',
    repoId: 'repo-1',
    displayName: 'remote',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 1,
    path: '/w',
    head: 'abc123',
    branch: 'main',
    isBare: false,
    isMainWorktree: true,
    hostId: 'ssh:box'
  }
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

it('says the panel lists this machine when the workspace runs elsewhere', async () => {
  useAppStore.setState({
    activeWorktreeId: 'wt-remote',
    activeWorkspaceExecutionHostId: 'ssh:box',
    worktreesByRepo: { 'repo-1': [remoteWorktree()] }
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
  expect(view.getByTestId('background-agent-dispatch-row').textContent).toContain('started')
  await act(async () => {
    vi.advanceTimersByTime(2000)
  })
  expect(view.queryByTestId('background-agent-dispatch-row')).toBeNull()
})

it('focuses the composer with the slash key', async () => {
  const view = await renderScreen()
  await press(view.getByTestId('background-agents-list'), '/')
  expect(document.activeElement).toBe(view.getByLabelText('New background agent'))
})
