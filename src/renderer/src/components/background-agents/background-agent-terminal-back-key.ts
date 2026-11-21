import {
  readTerminalCursorLineContext,
  type TerminalCursorContextSource
} from '../../../../shared/terminal/input/terminal-cursor-line-context'
import { readTerminalComposerTypedText } from '../../../../shared/terminal/input/terminal-composer-draft'

/**
 * The left arrow that leaves an agent's terminal.
 *
 * The agent's own TUI reads the left arrow as "back", so an unmodified press would take the user
 * into the CLI's own agent view instead of Orca's agent list. The modified arrows stay with the
 * agent: they move the cursor.
 *
 * An arrow the agent's own prompt can use stays with the agent as well: while the user has typed
 * into that prompt the arrow moves the caret, and taking it would throw the typed text away.
 *
 * The whole chord is claimed, press and release alike — claiming only the press lets the release
 * reach xterm's Kitty encoder and sends stray bytes to the agent.
 */
export function claimAgentTerminalBackKey(
  event: KeyboardEvent,
  onBack: () => void,
  /** The terminal the agent runs in; its prompt says whether the user has typed something. */
  terminal?: TerminalCursorContextSource
): boolean {
  if (event.key !== 'ArrowLeft') {
    return false
  }
  // Why: the modified arrows move the cursor (cmd+left is line start), so they belong to the agent.
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
    return false
  }
  if (hasTypedPromptText(terminal)) {
    return false
  }
  if (event.type === 'keydown' && !event.repeat) {
    event.preventDefault()
    event.stopPropagation()
    onBack()
  }
  return true
}

/**
 * Whether the agent's own prompt holds text the user typed.
 *
 * A terminal that cannot be read is not evidence of typed text, so the arrow still leaves.
 */
function hasTypedPromptText(terminal: TerminalCursorContextSource | undefined): boolean {
  if (!terminal) {
    return false
  }
  let typed: string | null = null
  try {
    typed = readTerminalComposerTypedText(readTerminalCursorLineContext(terminal, terminal.rows))
  } catch {
    // Why: a terminal without a readable buffer says nothing about the prompt.
  }
  return (typed ?? '').trim() !== ''
}
