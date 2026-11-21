// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store/index'

const mocks = vi.hoisted(() => ({
  callRuntimeRpc: vi.fn(),
  previewPtyId: { current: null as string | null }
}))

vi.mock('@/runtime/rpc/calls/runtime-rpc-call', () => ({
  callRuntimeRpc: mocks.callRuntimeRpc
}))
vi.mock('@/components/dashboard-popout/AgentTerminalPreview', () => ({
  AgentTerminalPreview: ({ ptyId }: { ptyId: string }) => {
    mocks.previewPtyId.current = ptyId
    return <div data-testid="agent-terminal-preview" />
  }
}))
vi.mock('sonner', () => ({
  toast: { error: vi.fn() }
}))

import { BackgroundAgentRemoteTerminal } from './BackgroundAgentRemoteTerminal'

const ENVIRONMENT_ID = 'env-remote'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.previewPtyId.current = null
  mocks.callRuntimeRpc.mockResolvedValue({ terminal: { handle: 'handle-1' } })
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
