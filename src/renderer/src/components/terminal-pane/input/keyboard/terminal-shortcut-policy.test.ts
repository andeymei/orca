import { describe, expect, it } from 'vitest'
import {
  resolveTerminalShortcutAction,
  type TerminalShortcutEvent
} from './terminal-shortcut-policy'

const event = (over: Partial<TerminalShortcutEvent> = {}): TerminalShortcutEvent => ({
  key: 'P',
  code: 'KeyP',
  metaKey: true,
  shiftKey: true,
  ctrlKey: false,
  altKey: false,
  ...over
})

describe('resolveTerminalShortcutAction', () => {
  it('resolves Mod+Shift+P to the composer toggle and nothing else', () => {
    expect(resolveTerminalShortcutAction(event(), true)).toEqual({ type: 'toggleComposer' })
    expect(resolveTerminalShortcutAction(event({ shiftKey: false }), true)).toBeNull()
  })
})
