import { stripInheritedAgentSessionEnv } from '../../../shared/agent-launch/startup/parent-agent-session-env'

/**
 * A panel's agent is not a Claude background job.
 *
 * The PTY path deletes the inherited job dir for the same reason: a pane is never a Claude
 * background job, and a job dir the CLI inherits would make it treat the command as part of one.
 */
const PANEL_JOB_DIR_ENV_KEY = 'CLAUDE_JOB_DIR'

/**
 * The environment the panel's Claude Code commands run in.
 *
 * A panel command is Orca's own, not part of the agent session that happens to be running Orca:
 * the CLI continues that session instead of answering the command, so the dispatch hands the user
 * their own session back instead of a new agent, and `claude rm` deletes inside a session it does
 * not own. The stamps are the repo's own list, and the inherited job dir goes with them.
 *
 * The job dir is deleted here rather than through the helper's `envToDelete`, because that option
 * only removes session stamps and the job dir is not one.
 *
 * The shell capture is shared and cached, so the strip works on a copy of it.
 */
export function backgroundAgentCommandEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const commandEnv: NodeJS.ProcessEnv = { ...env }
  stripInheritedAgentSessionEnv(commandEnv)
  delete commandEnv[PANEL_JOB_DIR_ENV_KEY]
  return commandEnv
}
