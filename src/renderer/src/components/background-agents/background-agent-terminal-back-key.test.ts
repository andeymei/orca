// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import type { TerminalCursorContextSource } from '../../../../shared/terminal/input/terminal-cursor-line-context'
import { claimAgentTerminalBackKey } from './background-agent-terminal-back-key'

type FakeCell = {
  getChars(): string
  getWidth(): number
  isBold(): boolean
  isDim(): boolean
  isFgDefault(): boolean
  isInverse(): boolean
}

function fakeCell(chars: string): FakeCell {
  return {
    getChars: () => chars,
    getWidth: () => 1,
    isBold: () => false,
    isDim: () => false,
    isFgDefault: () => true,
    isInverse: () => false
  }
}

function fakeLine(text: string) {
  return {
    isWrapped: false,
    length: text.length,
    getCell(column: number): FakeCell | undefined {
      return column < text.length ? fakeCell(text[column] ?? ' ') : undefined
    },
    translateToString(trimRight = false, startColumn = 0, endColumn = text.length): string {
      const slice = text.slice(startColumn, endColumn)
      return trimRight ? slice.trimEnd() : slice
    }
  }
}

/** A terminal whose screen holds Claude's composer, with the caret at the given column. */
function terminalWithPrompt(prompt: string, cursorX: number): TerminalCursorContextSource {
  const rows = ['────────', `❯ ${prompt}`, '────────']
  return {
    rows: 24,
    modes: { showCursor: false },
    buffer: {
      active: {
        type: 'normal',
        baseY: 0,
        cursorX,
        cursorY: 1,
        viewportY: 0,
        getLine: (row: number) => (rows[row] === undefined ? undefined : fakeLine(rows[row] ?? '')),
        getNullCell: () => fakeCell(' ')
      }
    }
  }
}

function leftArrow(): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: 'ArrowLeft' })
}

describe('the left arrow that leaves an agent', () => {
  it('leaves the agent when its own prompt holds nothing', () => {
    const onBack = vi.fn()

    expect(claimAgentTerminalBackKey(leftArrow(), onBack, terminalWithPrompt('', 2))).toBe(true)
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('stays with the agent while its prompt holds the text the user typed', () => {
    const onBack = vi.fn()

    expect(claimAgentTerminalBackKey(leftArrow(), onBack, terminalWithPrompt('hello', 7))).toBe(
      false
    )
    expect(onBack).not.toHaveBeenCalled()
  })

  it('leaves the agent when the terminal cannot be read', () => {
    const onBack = vi.fn()

    expect(claimAgentTerminalBackKey(leftArrow(), onBack)).toBe(true)
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('leaves the modified arrows to the agent, which moves the cursor with them', () => {
    const onBack = vi.fn()
    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', metaKey: true })

    expect(claimAgentTerminalBackKey(event, onBack, terminalWithPrompt('', 2))).toBe(false)
    expect(onBack).not.toHaveBeenCalled()
  })
})
