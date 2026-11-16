// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import { useAppStore } from '@/store/index'
import { BackgroundAgentTerminal } from './background-agent-terminal'

type SpawnOptions = {
  cols: number
  rows: number
  cwd?: string
  command?: string
  commandDelivery?: 'renderer' | 'provider'
  worktreeId?: string
}

type FakeTerminal = {
  handler: ((event: KeyboardEvent) => boolean) | null
  written: string[]
  /** What the custom handler answered for each key event: false means xterm must not encode it. */
  xtermHandles: boolean[]
}

const harness = vi.hoisted(() => {
  const terminals: FakeTerminal[] = []
  const watchers = new Map<string, (data: string) => void>()
  return { terminals, watchers }
})

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    element: HTMLElement | undefined
    options: Record<string, unknown> = {}
    handler: ((event: KeyboardEvent) => boolean) | null = null
    written: string[] = []
    xtermHandles: boolean[] = []
    constructor() {
      harness.terminals.push(this)
    }
    open(container: HTMLElement): void {
      this.element = container
      // Why: xterm routes its keyboard events through the custom handler; the mock does the same.
      const route = (event: KeyboardEvent): void => {
        this.xtermHandles.push(this.handler?.(event) ?? false)
      }
      container.addEventListener('keydown', route)
      container.addEventListener('keyup', route)
    }
    dispose(): void {}
    onData(): { dispose: () => void } {
      return { dispose: () => {} }
    }
    onResize(): { dispose: () => void } {
      return { dispose: () => {} }
    }
    write(data: string, callback?: () => void): void {
      this.written.push(data)
      callback?.()
    }
    input(_data: string): void {}
    loadAddon(): void {}
    focus(): void {}
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void {
      this.handler = handler
    }
    hasSelection(): boolean {
      return false
    }
    getSelection(): string {
      return ''
    }
    selectAll(): void {}
    scrollToTop(): void {}
    scrollToBottom(): void {}
  }
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit(): void {}
    proposeDimensions(): undefined {
      return undefined
    }
  }
}))
vi.mock('@/components/dashboard-popout/preview-terminal-compatibility', () => ({
  installPreviewTerminalCompatibility: () => vi.fn()
}))
vi.mock('@/components/dashboard-popout/preview-terminal-ime-bridge', () => ({
  installPreviewImeBridge: () => ({ claimKeyEvent: () => false, dispose: vi.fn() })
}))
vi.mock('@/components/terminal-pane/pty-transport/delivery/pty-data-sidecar-subscriptions', () => ({
  subscribeToPtyData: (ptyId: string, watcher: (data: string) => void) => {
    harness.watchers.set(ptyId, watcher)
    return () => {
      harness.watchers.delete(ptyId)
    }
  }
}))

const spawn = vi.fn(async (_options: SpawnOptions) => ({ id: 'pty-1' }))
const kill = vi.fn(async (_id: string) => {})
const write = vi.fn()
const resize = vi.fn()
const setRendererPtyVisible = vi.fn()
const getMainBufferSnapshot = vi.fn(async (_id: string, _options: { scrollbackRows: number }) => ({
  data: 'the first frame',
  cols: 80,
  rows: 24
}))

beforeEach(() => {
  vi.stubGlobal('api', {
    pty: { spawn, kill, write, resize, setRendererPtyVisible, getMainBufferSnapshot }
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
    }
  )
  harness.terminals.length = 0
  harness.watchers.clear()
  vi.clearAllMocks()
  useAppStore.setState({
    backgroundAgentsScreen: { kind: 'agent', agentId: 'aaaa1111' },
    backgroundAgentsAttachedPtyId: null
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('spawns one detached PTY for the agent and kills it when the user leaves the screen', async () => {
  const view = render(<BackgroundAgentTerminal agentId="aaaa1111" cwd="/w" onBack={() => {}} />)
  await waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
  expect(spawn.mock.calls[0][0]).toMatchObject({
    commandDelivery: 'provider',
    worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
    cwd: '/w'
  })
  expect(spawn.mock.calls[0][0].command).toContain('attach')
  expect(spawn.mock.calls[0][0].command).toContain('aaaa1111')
  // The user left the screen, so the attach client goes away with it.
  useAppStore.getState().closeBackgroundAgent()
  view.unmount()
  await waitFor(() => expect(kill).toHaveBeenCalledWith('pty-1'))
  expect(useAppStore.getState().backgroundAgentsAttachedPtyId).toBeNull()
})

it('keeps the attach alive when the sidebar tab is switched', async () => {
  const first = render(<BackgroundAgentTerminal agentId="aaaa1111" cwd="/w" onBack={() => {}} />)
  await waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
  // The panel unloaded, but the supervisor still shows this agent.
  first.unmount()
  expect(kill).not.toHaveBeenCalled()
  expect(useAppStore.getState().backgroundAgentsAttachedPtyId).toBe('pty-1')
  render(<BackgroundAgentTerminal agentId="aaaa1111" cwd="/w" onBack={() => {}} />)
  await waitFor(() =>
    expect(getMainBufferSnapshot).toHaveBeenCalledWith('pty-1', expect.anything())
  )
  expect(spawn).toHaveBeenCalledTimes(1)
})

it('returns to the list when the left arrow is pressed', async () => {
  const onBack = vi.fn()
  const view = render(<BackgroundAgentTerminal agentId="aaaa1111" cwd="/w" onBack={onBack} />)
  await waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
  fireEvent.keyDown(view.getByTestId('background-agent-terminal'), { key: 'ArrowLeft' })
  expect(onBack).toHaveBeenCalledTimes(1)
})

it('lets the cursor move left when the arrow carries a modifier', async () => {
  const onBack = vi.fn()
  const view = render(<BackgroundAgentTerminal agentId="aaaa1111" cwd="/w" onBack={onBack} />)
  await waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
  fireEvent.keyDown(view.getByTestId('background-agent-terminal'), {
    key: 'ArrowLeft',
    metaKey: true
  })
  expect(onBack).not.toHaveBeenCalled()
})

it('claims the whole arrow chord, so the release never reaches the agent', async () => {
  const view = render(<BackgroundAgentTerminal agentId="aaaa1111" cwd="/w" onBack={() => {}} />)
  await waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
  const container = view.getByTestId('background-agent-terminal')
  fireEvent.keyDown(container, { key: 'ArrowLeft' })
  fireEvent.keyUp(container, { key: 'ArrowLeft' })
  // Why: xterm encodes whatever the custom handler lets through, and the release bytes would
  // go out to `claude attach`.
  expect(harness.terminals[0].xtermHandles).toEqual([false, false])
})

it('writes the agent output into the terminal', async () => {
  render(<BackgroundAgentTerminal agentId="aaaa1111" cwd="/w" onBack={() => {}} />)
  await waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(harness.watchers.has('pty-1')).toBe(true))
  const terminal = harness.terminals[0]
  expect(terminal.written).toContain('the first frame')
  harness.watchers.get('pty-1')?.('the live frame')
  expect(terminal.written).toContain('the live frame')
  expect(setRendererPtyVisible).toHaveBeenCalledWith('pty-1', true)
})
