// @vitest-environment happy-dom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type * as I18n from '@/i18n/i18n'
import { useAppStore } from '@/store/index'
import { BackgroundAgentTerminal } from './background-agent-terminal'

/**
 * The main-side cliff.
 *
 * Main stops delivering to a renderer whose unacknowledged bytes reach this number
 * (`PTY_RENDERER_IN_FLIGHT_HIGH_WATER_CHARS`, `src/main/ipc/pty/delivery/constants.ts`). The
 * number is written out here rather than imported: a test that read the production constant
 * would follow it silently instead of noticing that the cliff moved.
 */
const MAIN_IN_FLIGHT_CLIFF_CHARS = 512 * 1024

/** How many characters one push carries. */
const CHUNK_CHARS = 64 * 1024

/** How many chunks to push; ten chunks are well past the cliff. */
const CHUNK_COUNT = 10

const harness = vi.hoisted(() => {
  /** The callback the dispatcher registered on the PTY data channel. */
  const dataCallbacks: ((payload: { id: string; data: string }) => void)[] = []
  /** What the renderer acknowledged, per call. */
  const acks: { id: string; chars: number; processedChars: number | undefined }[] = []
  /** What the terminal received. */
  const written: string[] = []
  return { dataCallbacks, acks, written }
})

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    element: HTMLElement | undefined
    options: Record<string, unknown> = {}
    handler: ((event: KeyboardEvent) => boolean) | null = null
    constructor() {}
    open(container: HTMLElement): void {
      this.element = container
    }
    dispose(): void {}
    onData(): { dispose: () => void } {
      return { dispose: () => {} }
    }
    onResize(): { dispose: () => void } {
      return { dispose: () => {} }
    }
    write(data: string, callback?: () => void): void {
      harness.written.push(data)
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
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof I18n>()),
  translate: (_key: string, fallback: string) => fallback
}))

const spawn = vi.fn(async (_options: unknown) => ({ id: 'pty-1' }))

beforeEach(() => {
  harness.dataCallbacks.length = 0
  harness.acks.length = 0
  harness.written.length = 0
  vi.stubGlobal('api', {
    pty: {
      spawn,
      kill: vi.fn(async (_id: string) => {}),
      write: vi.fn(),
      resize: vi.fn(),
      setRendererPtyVisible: vi.fn(),
      getMainBufferSnapshot: vi.fn(async (_id: string, _options: unknown) => ({
        data: '',
        cols: 80,
        rows: 24
      })),
      // The dispatcher registers here; the test pushes the bytes through the captured callback.
      onData: (callback: (payload: { id: string; data: string }) => void) => {
        harness.dataCallbacks.push(callback)
        return () => {}
      },
      onReplay: () => () => {},
      onExit: () => () => {},
      ackData: (id: string, chars: number, processedChars?: number) => {
        harness.acks.push({ id, chars, processedChars })
      }
    }
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
    }
  )
  useAppStore.setState({
    backgroundAgentsScreen: { kind: 'agent', agentId: 'aaaa1111' },
    backgroundAgentsAttachedPtyId: null
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it('acknowledges every character the panel terminal receives, past the main-side cliff', async () => {
  render(<BackgroundAgentTerminal agentId="aaaa1111" cwd="/w" onBack={() => {}} />)

  // The panel subscribes through the real sidecar module, and that subscription is what installs
  // the dispatcher — so the data channel has a listener by the time the panel is attached.
  await waitFor(() => expect(harness.dataCallbacks.length).toBeGreaterThan(0))
  const push = harness.dataCallbacks.at(-1)
  if (!push) {
    throw new Error('the panel subscription did not install the PTY dispatcher')
  }

  const chunk = 'x'.repeat(CHUNK_CHARS)
  for (let index = 0; index < CHUNK_COUNT; index++) {
    push({ id: 'pty-1', data: chunk })
  }
  const pushedChars = CHUNK_CHARS * CHUNK_COUNT
  expect(pushedChars).toBeGreaterThan(MAIN_IN_FLIGHT_CLIFF_CHARS)

  // The panel's terminal received all of it.
  const writtenChars = harness.written.reduce((sum, text) => sum + text.length, 0)
  expect(writtenChars).toBeGreaterThanOrEqual(pushedChars)

  // And the renderer acknowledged all of it, so main's in-flight debt for this PTY never reaches
  // the cliff: the delivery does not stall.
  const acknowledgedChars = harness.acks.reduce((sum, ack) => sum + ack.chars, 0)
  expect(acknowledgedChars).toBe(pushedChars)
  const lastAck = harness.acks.at(-1)
  expect(lastAck?.id).toBe('pty-1')
  expect(lastAck?.processedChars).toBe(pushedChars)
})
