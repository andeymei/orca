// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store/index'

const mocks = vi.hoisted(() => ({
  callRuntimeRpc: vi.fn(),
  previewPtyId: { current: null as string | null },
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the ref starts null and the test assigns the claim function to it; a bare null would infer the property as null.
  claimKeyEvent: { current: null as ((event: KeyboardEvent) => boolean) | null }
}))

vi.mock('@/runtime/rpc/calls/runtime-rpc-call', () => ({
  callRuntimeRpc: mocks.callRuntimeRpc
}))
vi.mock('@/components/dashboard-popout/AgentTerminalPreview', () => ({
  AgentTerminalPreview: ({
    ptyId,
    claimKeyEvent
  }: {
    ptyId: string
    claimKeyEvent?: (event: KeyboardEvent) => boolean
  }) => {
    mocks.previewPtyId.current = ptyId
    mocks.claimKeyEvent.current = claimKeyEvent ?? null
    return <div data-testid="agent-terminal-preview" />
  }
}))
vi.mock('sonner', () => ({
  toast: { error: vi.fn() }
}))

import { BackgroundAgentRemoteTerminal } from './BackgroundAgentRemoteTerminal'
import { resetHostPlatformsForTests } from './background-agent-host-platform'

const ENVIRONMENT_ID = 'env-remote'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.previewPtyId.current = null
  mocks.claimKeyEvent.current = null
  resetHostPlatformsForTests()
  // Why two answers: the panel asks the host what it runs before it runs the attach.
  let creates = 0
  mocks.callRuntimeRpc.mockImplementation(
    async (_target: unknown, method: string): Promise<unknown> => {
      if (method !== 'terminal.create') {
        return undefined
      }
      creates += 1
      return creates === 1
        ? { terminal: { handle: 'probe-1', hostPlatform: 'linux' } }
        : { terminal: { handle: 'handle-1' } }
    }
  )
  useAppStore.setState({
    activeWorkspaceExecutionHostId: `runtime:${ENVIRONMENT_ID}`
  })
})

afterEach(() => {
  cleanup()
})

it('previews the agent’s terminal on the host that runs it', async () => {
  const view = render(
    <BackgroundAgentRemoteTerminal agentId="aaaa1111" cwd="/w" onBack={() => {}} />
  )

  await act(async () => {
    await Promise.resolve()
  })
  expect(mocks.callRuntimeRpc).toHaveBeenCalledWith(
    { kind: 'environment', environmentId: ENVIRONMENT_ID },
    'terminal.create',
    expect.objectContaining({
      worktree: 'id:global-floating-terminal',
      command: "claude attach 'aaaa1111'",
      presentation: 'background'
    }),
    { timeoutMs: 15_000 }
  )
  expect(mocks.previewPtyId.current).toBe(`remote:${ENVIRONMENT_ID}@@handle-1`)
  expect(view.getByTestId('agent-terminal-preview')).toBeTruthy()
})

it('closes the host’s terminal when the user leaves the agent', async () => {
  const view = render(
    <BackgroundAgentRemoteTerminal agentId="aaaa1111" cwd="/w" onBack={() => {}} />
  )
  await act(async () => {
    await Promise.resolve()
  })

  await act(async () => {
    view.unmount()
  })
  expect(mocks.callRuntimeRpc).toHaveBeenCalledWith(
    { kind: 'environment', environmentId: ENVIRONMENT_ID },
    'terminal.close',
    { terminal: 'handle-1' },
    { timeoutMs: 15_000 }
  )
})

it('takes the left arrow back to the list instead of the agent’s own view', async () => {
  const onBack = vi.fn()
  render(<BackgroundAgentRemoteTerminal agentId="aaaa1111" cwd="/w" onBack={onBack} />)
  await act(async () => {
    await Promise.resolve()
  })

  const claim = mocks.claimKeyEvent.current
  expect(claim).toBeTruthy()
  const press = (init: KeyboardEventInit): KeyboardEvent =>
    new KeyboardEvent('keydown', { key: 'ArrowLeft', ...init })

  expect(claim?.(press({}))).toBe(true)
  expect(onBack).toHaveBeenCalledTimes(1)
  // Why: the modified arrows move the cursor, so they belong to the agent.
  expect(claim?.(press({ metaKey: true }))).toBe(false)
  expect(onBack).toHaveBeenCalledTimes(1)
})
