/**
 * The left arrow that leaves an agent's terminal.
 *
 * The agent's own TUI reads the left arrow as "back", so an unmodified press would take the user
 * into the CLI's own agent view instead of Orca's agent list. The modified arrows stay with the
 * agent: they move the cursor.
 *
 * The whole chord is claimed, press and release alike — claiming only the press lets the release
 * reach xterm's Kitty encoder and sends stray bytes to the agent.
 */
export function claimAgentTerminalBackKey(event: KeyboardEvent, onBack: () => void): boolean {
  if (event.key !== 'ArrowLeft') {
    return false
  }
  // Why: the modified arrows move the cursor (cmd+left is line start), so they belong to the agent.
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
    return false
  }
  if (event.type === 'keydown' && !event.repeat) {
    event.preventDefault()
    event.stopPropagation()
    onBack()
  }
  return true
}
