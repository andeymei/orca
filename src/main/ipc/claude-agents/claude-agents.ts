import { ipcMain } from 'electron'
import type {
  ClaudeBackgroundAgent,
  ClaudeBackgroundAgentCommandResult,
  ClaudeBackgroundAgentDetail,
  ClaudeBackgroundAgentDispatchArgs,
  ClaudeBackgroundAgentIdArgs,
  ClaudeBackgroundAgentListResult
} from '../../../shared/claude-background-agents'
import {
  dispatchClaudeBackgroundAgent,
  removeClaudeBackgroundAgent,
  stopClaudeBackgroundAgent
} from '../../claude/background-agents/claude-background-agent-commands'
import { readClaudeBackgroundAgentJobState } from '../../claude/background-agents/claude-background-agent-job-state'
import { listClaudeBackgroundAgentsOrNull } from '../../claude/background-agents/claude-background-agent-list'

/**
 * The two sources of the panel, merged into one answer.
 *
 * The CLI says which agents live; the job state file says what each one is doing. A file that
 * cannot be read leaves its row without an activity line rather than losing the row.
 */
export async function buildClaudeBackgroundAgentListResult(
  listAgents: () => Promise<ClaudeBackgroundAgent[] | null>,
  readDetail: (id: string) => Promise<ClaudeBackgroundAgentDetail | null>
): Promise<ClaudeBackgroundAgentListResult> {
  try {
    const agents = await listAgents()
    if (agents === null) {
      return { status: 'unsupported', agents: [], details: {}, message: null }
    }
    const details = await readClaudeBackgroundAgentDetails(
      agents.map((agent) => agent.id),
      readDetail
    )
    return { status: 'ready', agents, details, message: null }
  } catch (error) {
    return { status: 'error', agents: [], details: {}, message: readErrorMessage(error) }
  }
}

/** The activity lines of the given agents, keyed by agent id. */
async function readClaudeBackgroundAgentDetails(
  ids: readonly string[],
  readDetail: (id: string) => Promise<ClaudeBackgroundAgentDetail | null>
): Promise<Record<string, ClaudeBackgroundAgentDetail>> {
  const details: Record<string, ClaudeBackgroundAgentDetail> = {}
  for (const id of ids) {
    // Why: a state file the CLI is rewriting must not take the other agents' rows down.
    const detail = await readDetail(id).catch(() => null)
    if (detail) {
      details[id] = detail
    }
  }
  return details
}

export function registerClaudeAgentsHandlers(): void {
  ipcMain.handle('claudeAgents:list', (): Promise<ClaudeBackgroundAgentListResult> =>
    buildClaudeBackgroundAgentListResult(
      () => listClaudeBackgroundAgentsOrNull(),
      (id) => readClaudeBackgroundAgentJobState(id)
    )
  )
  // The fast poll asks only for the activity lines; the slow one asks the CLI for the roster.
  // The ids are checked against the CLI's short-id pattern inside readClaudeBackgroundAgentJobState,
  // before the id becomes a path segment, so this layer does not validate them a second time.
  ipcMain.handle(
    'claudeAgents:readDetails',
    (_event, ids: string[]): Promise<Record<string, ClaudeBackgroundAgentDetail>> =>
      readClaudeBackgroundAgentDetails(Array.isArray(ids) ? ids : [], (id) =>
        readClaudeBackgroundAgentJobState(id)
      )
  )
  ipcMain.handle(
    'claudeAgents:dispatch',
    (
      _event,
      args: ClaudeBackgroundAgentDispatchArgs
    ): Promise<ClaudeBackgroundAgentCommandResult> => dispatchClaudeBackgroundAgent(args)
  )
  ipcMain.handle(
    'claudeAgents:stop',
    (_event, args: ClaudeBackgroundAgentIdArgs): Promise<ClaudeBackgroundAgentCommandResult> =>
      stopClaudeBackgroundAgent(args)
  )
  ipcMain.handle(
    'claudeAgents:remove',
    (_event, args: ClaudeBackgroundAgentIdArgs): Promise<ClaudeBackgroundAgentCommandResult> =>
      removeClaudeBackgroundAgent(args)
  )
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
