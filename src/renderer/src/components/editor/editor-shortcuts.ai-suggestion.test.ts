// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installEditorAcceptAiSuggestionShortcut,
  installEditorAiSuggestionPreviewShortcut
} from './editor-shortcuts'
import type { NesTabDecision } from './code-completion/nes-key-routing'

vi.mock('@/store', () => ({ useAppStore: { getState: () => ({ keybindings: {} }) } }))

const disposers: (() => void)[] = []

afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    dispose()
  }
  document.body.replaceChildren()
})

function createTarget(): HTMLElement {
  const target = document.createElement('div')
  document.body.append(target)
  return target
}

function pressKey(target: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
    ...init
  })
  target.dispatchEvent(event)
  return event
}

function installTabShortcut(
  decision: NesTabDecision,
  hasNextLocation = false
): {
  target: HTMLElement
  onAccept: ReturnType<typeof vi.fn>
  onJump: ReturnType<typeof vi.fn>
} {
  const target = createTarget()
  const onAccept = vi.fn()
  const onJump = vi.fn()
  disposers.push(
    installEditorAcceptAiSuggestionShortcut(
      target,
      () => decision,
      onAccept,
      onJump,
      () => hasNextLocation
    )
  )
  return { target, onAccept, onJump }
}

describe('installEditorAcceptAiSuggestionShortcut', () => {
  it('leaves the key to the editor when there is nothing to do', () => {
    const { target, onAccept, onJump } = installTabShortcut('pass-through')

    const event = pressKey(target, 'Tab')

    expect(event.defaultPrevented).toBe(false)
    expect(onAccept).not.toHaveBeenCalled()
    expect(onJump).not.toHaveBeenCalled()
  })

  it('consumes the key and accepts when a suggestion is showing', () => {
    const { target, onAccept, onJump } = installTabShortcut('accept-suggestion')

    const event = pressKey(target, 'Tab')

    expect(event.defaultPrevented).toBe(true)
    expect(onAccept).toHaveBeenCalledOnce()
    expect(onJump).not.toHaveBeenCalled()
  })

  it('consumes the key and jumps when the plan has other locations', () => {
    const { target, onAccept, onJump } = installTabShortcut('jump-to-next-location', true)

    const event = pressKey(target, 'Tab')

    expect(event.defaultPrevented).toBe(true)
    expect(onJump).toHaveBeenCalledOnce()
    expect(onAccept).not.toHaveBeenCalled()
  })

  it('does not accept twice while the key is held', () => {
    const { target, onAccept } = installTabShortcut('accept-suggestion')

    pressKey(target, 'Tab')
    const repeat = pressKey(target, 'Tab', { repeat: true })

    expect(onAccept).toHaveBeenCalledOnce()
    expect(repeat.defaultPrevented).toBe(true)
  })

  it('jumps on the next-suggestion chord', () => {
    const { target, onAccept, onJump } = installTabShortcut('jump-to-next-location', true)

    const event = pressKey(target, 'F8')

    expect(event.defaultPrevented).toBe(true)
    expect(onJump).toHaveBeenCalledOnce()
    expect(onAccept).not.toHaveBeenCalled()
  })

  it('leaves the jump chord alone when there is no next location', () => {
    const { target, onAccept, onJump } = installTabShortcut('accept-suggestion')

    const event = pressKey(target, 'F8')

    expect(event.defaultPrevented).toBe(false)
    expect(onJump).not.toHaveBeenCalled()
    expect(onAccept).not.toHaveBeenCalled()
  })
})

describe('installEditorAiSuggestionPreviewShortcut', () => {
  it('reports the held Alt without consuming it', () => {
    const target = createTarget()
    const onPreview = vi.fn()
    disposers.push(installEditorAiSuggestionPreviewShortcut(target, onPreview))

    const down = pressKey(target, 'Alt')
    target.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Alt', bubbles: true, cancelable: true })
    )

    expect(onPreview).toHaveBeenNthCalledWith(1, true)
    expect(onPreview).toHaveBeenNthCalledWith(2, false)
    expect(down.defaultPrevented).toBe(false)
  })
})
