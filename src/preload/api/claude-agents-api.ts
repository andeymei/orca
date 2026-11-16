import type {
  ClaudeBackgroundAgentCommandResult,
  ClaudeBackgroundAgentDetail,
  ClaudeBackgroundAgentDispatchArgs,
  ClaudeBackgroundAgentIdArgs,
  ClaudeBackgroundAgentListResult
} from '../../shared/claude-background-agents'

export type ClaudeAgentsApi = {
  /** The agents on this machine and what each one is doing. */
  list: () => Promise<ClaudeBackgroundAgentListResult>
  /** The activity lines of the given agents; the fast poll asks only for these. */
  readDetails: (ids: string[]) => Promise<Record<string, ClaudeBackgroundAgentDetail>>
  /** Start a background agent; the CLI answers with the id it gave it. */
  dispatch: (args: ClaudeBackgroundAgentDispatchArgs) => Promise<ClaudeBackgroundAgentCommandResult>
  /** Stop an agent; its conversation is kept. */
  stop: (args: ClaudeBackgroundAgentIdArgs) => Promise<ClaudeBackgroundAgentCommandResult>
  /** Delete an agent and its worktree. */
  remove: (args: ClaudeBackgroundAgentIdArgs) => Promise<ClaudeBackgroundAgentCommandResult>
}
