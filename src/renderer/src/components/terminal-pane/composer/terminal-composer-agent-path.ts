import { isWslUncPath } from '../../../../../shared/wsl-paths'
import { toLocalWslDropPath } from '../input/file-drop/terminal-drop-local-wsl'
import { isWslShellOverride } from '../input/paste/terminal-paste-runtime'

/** What the pane's session says about the world its agent lives in. */
export type TerminalComposerAgentSession = {
  cwd?: string
  shellOverride?: string
}

/**
 * The path the agent in this pane can open.
 *
 * A WSL agent reads Linux paths, not the Windows spelling of the same file, so the
 * rule asks about the pane's session rather than about how the workspace path
 * happens to be spelled. The two spellings can now only ever disagree in the
 * direction of "not converted": a session-less transport keeps the Windows path.
 */
export function terminalComposerAgentVisiblePath(
  session: TerminalComposerAgentSession | null | undefined,
  path: string
): string {
  const runsInWsl = isWslUncPath(session?.cwd ?? '') || isWslShellOverride(session?.shellOverride)
  return runsInWsl ? toLocalWslDropPath(path) : path
}
