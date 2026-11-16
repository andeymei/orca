// @vitest-environment happy-dom
import type * as I18n from '@/i18n/i18n'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ClaudeBackgroundAgent } from '../../../../shared/claude-background-agents'
import { useAppStore } from '@/store/index'
import { BackgroundAgentAgentScreen } from './BackgroundAgentAgentScreen'

type TerminalProps = { agentId: string; cwd: string | null; onBack: () => void }

const terminalProps = vi.hoisted(() => {
  const props: { current: TerminalProps | null } = { current: null }
  return props
})

vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof I18n>()),
  translate: (_key: string, fallback: string) => fallback
}))
vi.mock('./background-agent-terminal', () => ({
  // Why: the terminal has its own tests; here it only stands in for the attach.
  BackgroundAgentTerminal: (props: TerminalProps) => {
    terminalProps.current = props
    return <div data-agent-terminal-preview data-testid="background-agent-terminal-region" />
  }
}))

const AGENT: ClaudeBackgroundAgent = {
  id: 'aaaa1111',
  sessionId: 's1',
  name: 'claude agents cli',
  cwd: '/w',
  state: 'working',
  startedAt: Date.now() - 120_000
}

const list = vi.fn(async () => ({
  status: 'ready' as const,
  agents: [AGENT],
  details: {},
  message: null
}))

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('api', { claudeAgents: { list } })
  terminalProps.current = null
  vi.clearAllMocks()
  useAppStore.setState({
    backgroundAgentsScreen: { kind: 'agent', agentId: 'aaaa1111' },
    backgroundAgentsAgents: [AGENT],
    backgroundAgentsDetails: {},
    backgroundAgentsAttachedPtyId: null
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('names the agent and says what it is doing', () => {
  const view = render(<BackgroundAgentAgentScreen agentId="aaaa1111" />)
  expect(view.getByText('claude agents cli')).toBeTruthy()
  expect(view.getByText('working')).toBeTruthy()
  expect(view.getByText('/w')).toBeTruthy()
  expect(view.getByText('2m')).toBeTruthy()
})

it('gives the terminal the agent and its directory', () => {
  render(<BackgroundAgentAgentScreen agentId="aaaa1111" />)
  expect(terminalProps.current?.agentId).toBe('aaaa1111')
  expect(terminalProps.current?.cwd).toBe('/w')
})

it('follows the roster while the user sits in the terminal', async () => {
  const view = render(<BackgroundAgentAgentScreen agentId="aaaa1111" />)
  expect(view.getByText('working')).toBeTruthy()
  list.mockResolvedValue({
    status: 'ready',
    agents: [{ ...AGENT, state: 'blocked' }],
    details: {},
    message: null
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000)
  })
  expect(view.getByText('blocked')).toBeTruthy()
})

it('goes back to the list when the back button is pressed', () => {
  const view = render(<BackgroundAgentAgentScreen agentId="aaaa1111" />)
  fireEvent.click(view.getByRole('button', { name: 'Back to the agent list' }))
  expect(useAppStore.getState().backgroundAgentsScreen).toEqual({ kind: 'list' })
})

it('goes back to the list when Escape is pressed outside the terminal', () => {
  const view = render(<BackgroundAgentAgentScreen agentId="aaaa1111" />)
  fireEvent.keyDown(view.getByTestId('background-agents-agent'), { key: 'Escape' })
  expect(useAppStore.getState().backgroundAgentsScreen).toEqual({ kind: 'list' })
})

it('leaves Escape to the agent while the terminal has the focus', () => {
  const view = render(<BackgroundAgentAgentScreen agentId="aaaa1111" />)
  fireEvent.keyDown(view.getByTestId('background-agent-terminal-region'), { key: 'Escape' })
  expect(useAppStore.getState().backgroundAgentsScreen).toEqual({
    kind: 'agent',
    agentId: 'aaaa1111'
  })
})
