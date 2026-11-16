// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type * as I18n from '@/i18n/i18n'
import type * as OpenStandaloneTerminal from '@/components/standalone-terminal/open-standalone-terminal'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import { useAppStore } from '@/store/index'
import { isAgentTerminalPreviewTarget } from '@/components/dashboard-popout/agent-terminal-preview-target'
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
  return { terminals, watchers, openThrows: false }
})

const standaloneArgs = vi.hoisted(() => {
  const args: OpenStandaloneTerminal.StandaloneTerminalArgs[] = []
  return args
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
      if (harness.openThrows) {
        throw new Error('xterm cannot open here')
      }
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
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof I18n>()),
  translate: (_key: string, fallback: string) => fallback
}))
vi.mock('@/components/standalone-terminal/open-standalone-terminal', async (importOriginal) => {
  const actual = await importOriginal<typeof OpenStandaloneTerminal>()
  return {
    ...actual,
    openStandaloneTerminal: (args: OpenStandaloneTerminal.StandaloneTerminalArgs) => {
      standaloneArgs.push(args)
      return actual.openStandaloneTerminal(args)
    }
  }
})

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

/** A spawn whose resolution the test hands over by hand. */
function deferredSpawn(): { promise: Promise<{ id: string }>; resolve: (id: string) => void } {
  const pending: { resolve: (id: string) => void } = { resolve: () => {} }
  const promise = new Promise<{ id: string }>((resolve) => {
    pending.resolve = (id: string) => resolve({ id })
  })
  return { promise, resolve: (id: string) => pending.resolve(id) }
}

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
  harness.openThrows = false
  standaloneArgs.length = 0
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

it('marks the terminal as an agent terminal preview, so the app shortcuts step aside', () => {
  const view = render(<BackgroundAgentTerminal agentId="aaaa1111" cwd="/w" onBack={() => {}} />)
  expect(isAgentTerminalPreviewTarget(view.getByTestId('background-agent-terminal'))).toBe(true)
})

it('answers the agent terminal queries from the embedded terminal', async () => {
  render(<BackgroundAgentTerminal agentId="aaaa1111" cwd="/w" onBack={() => {}} />)
  await waitFor(() => expect(standaloneArgs).toHaveLength(1))
  expect(standaloneArgs[0].answersQueries).toBe(true)
})

it('hands the PTY to the renderer before the first snapshot', async () => {
  render(<BackgroundAgentTerminal agentId="aaaa1111" cwd="/w" onBack={() => {}} />)
  await waitFor(() => expect(getMainBufferSnapshot).toHaveBeenCalled())
  expect(setRendererPtyVisible).toHaveBeenCalledWith('pty-1', true)
  // Why: the TUI probes the terminal while it starts, so the xterm has to own the queries first.
  expect(setRendererPtyVisible.mock.invocationCallOrder[0]).toBeLessThan(
    getMainBufferSnapshot.mock.invocationCallOrder[0]
  )
})

it('says why the screen went back to the list when the terminal cannot open', async () => {
  harness.openThrows = true
  const onBack = vi.fn()
  render(<BackgroundAgentTerminal agentId="aaaa1111" cwd="/w" onBack={onBack} />)
  await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1))
  expect(toast.error).toHaveBeenCalledWith("The agent's terminal could not be opened")
})

it('says why the screen went back to the list when the attach cannot start', async () => {
  spawn.mockRejectedValueOnce(new Error('the daemon refused the spawn'))
  const onBack = vi.fn()
  render(<BackgroundAgentTerminal agentId="aaaa1111" cwd="/w" onBack={onBack} />)
  await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1))
  expect(toast.error).toHaveBeenCalledWith("The agent's terminal could not be opened")
})

it('kills the PTY a replaced screen spawned, and leaves the store to the newer screen', async () => {
  const stale = deferredSpawn()
  const live = deferredSpawn()
  spawn.mockImplementationOnce(() => stale.promise).mockImplementationOnce(() => live.promise)
  const first = render(<BackgroundAgentTerminal agentId="aaaa1111" cwd="/w" onBack={() => {}} />)
  await waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
  // The panel was unloaded while the spawn was on its way, and loaded again.
  first.unmount()
  render(<BackgroundAgentTerminal agentId="aaaa1111" cwd="/w" onBack={() => {}} />)
  await waitFor(() => expect(spawn).toHaveBeenCalledTimes(2))
  // The replaced screen's spawn resolves first: it must not take the store.
  await act(async () => {
    stale.resolve('pty-stale')
  })
  await waitFor(() => expect(kill).toHaveBeenCalledWith('pty-stale'))
  expect(useAppStore.getState().backgroundAgentsAttachedPtyId).toBeNull()
  await act(async () => {
    live.resolve('pty-live')
  })
  await waitFor(() => expect(useAppStore.getState().backgroundAgentsAttachedPtyId).toBe('pty-live'))
})
