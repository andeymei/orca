import type { ExecutionHostId } from '../../execution-host'

/** One terminal that is running an agent and is not on screen right now.
 *
 *  A terminal agent is a PTY whose title names an agent, so a plain shell running an agent CLI
 *  counts the same as one Orca launched itself. */
export type AgentSessionBackgroundTerminal = {
  /** The tab that carries the terminal. */
  tabId: string
  /** The agent the terminal is running, as its title names it. */
  agent: string
  /** The terminal's own title. */
  title: string
  workspaceId: string
  /** The host that runs the workspace, when it is not the local one. */
  executionHostId?: ExecutionHostId
  /** working — the agent is on a task; idle — it is waiting for the user. */
  state: 'working' | 'idle'
}
