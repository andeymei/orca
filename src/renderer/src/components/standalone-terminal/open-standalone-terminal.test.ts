// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { TerminalKittyKeyboardModeTracker } from '../../../../shared/terminal/protocol/input-modes/terminal-kitty-keyboard-mode-tracker'
import { openStandaloneTerminal } from './open-standalone-terminal'

type KeyHandler = (event: KeyboardEvent) => boolean

const harness = vi.hoisted<{ handlers: KeyHandler[] }>(() => ({ handlers: [] }))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    element: HTMLElement | undefined
    open(container: HTMLElement): void {
      this.element = container
    }
    dispose(): void {}
    onData(): { dispose: () => void } {
      return { dispose: () => {} }
    }
    write(_data: string, callback?: () => void): void {
      callback?.()
    }
    input(_data: string): void {}
    attachCustomKeyEventHandler(handler: KeyHandler): void {
      harness.handlers.push(handler)
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
vi.mock('../dashboard-popout/preview-terminal-compatibility', () => ({
  installPreviewTerminalCompatibility: () => vi.fn()
}))
vi.mock('../dashboard-popout/preview-terminal-ime-bridge', () => ({
  installPreviewImeBridge: () => ({ claimKeyEvent: () => false, dispose: vi.fn() })
}))

it('lets the caller claim a key before xterm encodes it', () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const standalone = openStandaloneTerminal({
    container,
    options: {},
    kittyKeyboardModes: new TerminalKittyKeyboardModeTracker(),
    sessionKey: 'pty-1',
    sendInput: () => true,
    answersQueries: true,
    getSettings: () => null,
    getMacOptionAsAlt: () => 'false',
    getTerminalInput: () => null,
    claimKeyEvent: (event) => event.key === 'ArrowLeft'
  })
  const handler = harness.handlers[0]
  expect(handler(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))).toBe(false)
  expect(handler(new KeyboardEvent('keydown', { key: 'a' }))).toBe(true)
  standalone?.dispose()
})
