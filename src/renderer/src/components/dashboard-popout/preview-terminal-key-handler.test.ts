// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import type { PreviewShortcutContext } from './preview-terminal-shortcuts'
import { installPreviewTerminalKeyHandler } from './preview-terminal-key-handler'

vi.mock('@/lib/keyboard/shortcut-platform', () => ({
  getShortcutPlatform: () => 'darwin'
}))

type KeyHandler = (event: KeyboardEvent) => boolean

const shortcutContext = {
  clientPlatform: 'darwin',
  macOptionAsAlt: 'false',
  keybindings: {},
  terminalInput: null,
  getKittyKeyboardFlags: () => 0,
  terminalShortcutPolicy: undefined
} satisfies Omit<PreviewShortcutContext, 'optionKeyLocations'>

/** Capture the handler xterm would own, so the test can drive it the way xterm does. */
function installHandler(args: {
  claimKeyEvent?: (event: KeyboardEvent) => boolean
  claimImeKeyEvent?: (event: KeyboardEvent) => boolean
}): { handler: KeyHandler; dispose: () => void } {
  const handlers: KeyHandler[] = []
  const terminal = {
    attachCustomKeyEventHandler: (handler: KeyHandler): void => {
      handlers.push(handler)
    },
    getSelection: () => '',
    hasSelection: () => false,
    scrollToTop: () => {},
    scrollToBottom: () => {},
    selectAll: () => {}
  }
  const dispose = installPreviewTerminalKeyHandler({
    terminal,
    claimImeKeyEvent: args.claimImeKeyEvent ?? (() => false),
    claimKeyEvent: args.claimKeyEvent,
    pasteClipboardText: () => {},
    sendInput: () => {},
    getShortcutContext: () => shortcutContext
  })
  return { handler: handlers[0], dispose }
}

function keydown(key: string, code: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true })
}

const ARROW_LEFT = keydown('ArrowLeft', 'ArrowLeft')
const LETTER_A = keydown('a', 'KeyA')

it('lets the caller claim a key before xterm encodes it', () => {
  const claimed: string[] = []
  const { handler, dispose } = installHandler({
    claimKeyEvent: (event) => {
      if (event.key === 'ArrowLeft') {
        claimed.push(event.key)
        return true
      }
      return false
    }
  })
  // A claimed key is swallowed: xterm must not encode the arrow as a cursor move.
  expect(handler(ARROW_LEFT)).toBe(false)
  expect(claimed).toEqual(['ArrowLeft'])
  dispose()
})

it('leaves the other keys to xterm', () => {
  const { handler, dispose } = installHandler({
    claimKeyEvent: (event) => event.key === 'ArrowLeft'
  })
  expect(handler(LETTER_A)).toBe(true)
  dispose()
})

it('offers the key to the caller before the IME bridge', () => {
  const order: string[] = []
  const { handler, dispose } = installHandler({
    claimKeyEvent: () => {
      order.push('claim')
      return false
    },
    claimImeKeyEvent: () => {
      order.push('ime')
      return true
    }
  })
  handler(ARROW_LEFT)
  expect(order).toEqual(['claim', 'ime'])
  dispose()
})

it('keeps the terminal unchanged when no caller claims keys', () => {
  const { handler, dispose } = installHandler({})
  expect(handler(ARROW_LEFT)).toBe(true)
  expect(handler(LETTER_A)).toBe(true)
  dispose()
})
