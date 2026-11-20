import type {
  ClaudeAgentsScope,
  ClaudeBackgroundAgentCommandResult,
  ClaudeBackgroundAgentDetail,
  ClaudeBackgroundAgentDispatchArgs,
  ClaudeBackgroundAgentIdArgs,
  ClaudeBackgroundAgentListResult
} from '../../shared/claude-background-agents'

export type ClaudeAgentsApi = {
  /** The agents the asking workspace's host owns and what each one is doing. */
  list: (scope?: ClaudeAgentsScope) => Promise<ClaudeBackgroundAgentListResult>
  /** The activity lines of the given agents; the fast poll asks only for these. */
  readDetails: (
    ids: string[],
    scope?: ClaudeAgentsScope
  ) => Promise<Record<string, ClaudeBackgroundAgentDetail>>
  /** Start a background agent; the CLI answers with the id it gave it. */
  dispatch: (args: ClaudeBackgroundAgentDispatchArgs) => Promise<ClaudeBackgroundAgentCommandResult>
  /** Cancel the dispatch that is still opening; there is nothing to cancel otherwise. */
  cancelDispatch: () => Promise<void>
  /** Stop an agent; its conversation is kept. */
  stop: (args: ClaudeBackgroundAgentIdArgs) => Promise<ClaudeBackgroundAgentCommandResult>
  /** Delete an agent and its worktree. */
  remove: (args: ClaudeBackgroundAgentIdArgs) => Promise<ClaudeBackgroundAgentCommandResult>
}
