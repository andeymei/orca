import { ipcMain } from 'electron'
import {
  isRecord,
  readClaudeAgentsScope,
  type ClaudeAgentsScope,
  type ClaudeBackgroundAgent,
  type ClaudeBackgroundAgentCommandResult,
  type ClaudeBackgroundAgentDetail,
  type ClaudeBackgroundAgentListResult
} from '../../../shared/claude-background-agents'
import { parseExecutionHostId } from '../../../shared/execution-host'
import {
  dispatchClaudeBackgroundAgent,
  removeClaudeBackgroundAgent,
  stopClaudeBackgroundAgent
} from '../../claude/background-agents/claude-background-agent-commands'
import { readClaudeBackgroundAgentJobState } from '../../claude/background-agents/claude-background-agent-job-state'
import { listClaudeBackgroundAgentsOrNull } from '../../claude/background-agents/claude-background-agent-list'
import {
  listRemoteClaudeBackgroundAgents,
  readRemoteClaudeBackgroundAgentDetails
} from '../../claude/background-agents/claude-background-agent-remote-list'

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
  // Why: the fast poll waits on every file, so they are read together instead of one after another.
  const reads = await Promise.all(
    ids.map(async (id) => ({
      id,
      // Why: a state file the CLI is rewriting must not take the other agents' rows down.
      detail: await readDetail(id).catch(() => null)
    }))
  )
  const details: Record<string, ClaudeBackgroundAgentDetail> = {}
  for (const read of reads) {
    if (read.detail) {
      details[read.id] = read.detail
    }
  }
  return details
}

/**
 * The commands and read sources this layer runs; injected so the tests can replace them.
 *
 * The dispatch has to be interruptible: the panel may cancel it while the agent is still opening.
 */
export type ClaudeAgentsHandlerDependencies = {
  dispatch?: typeof dispatchClaudeBackgroundAgent
  stop?: typeof stopClaudeBackgroundAgent
  remove?: typeof removeClaudeBackgroundAgent
  listLocal?: typeof listClaudeBackgroundAgentsOrNull
  readLocalDetail?: typeof readClaudeBackgroundAgentJobState
  listRemote?: typeof listRemoteClaudeBackgroundAgents
  readRemoteDetails?: typeof readRemoteClaudeBackgroundAgentDetails
  userDataPath?: () => string | Promise<string>
}

/**
 * The roster for the workspace that asked.
 *
 * A `local` (or absent) host keeps the CLI listing exactly as it was. A `runtime:` host is read
 * from that machine's `~/.claude/jobs`, because its worktrees do not exist on this machine. An
 * `ssh:` host cannot answer this version: the panel says so rather than showing local agents.
 */
export async function buildClaudeBackgroundAgentListResultForScope(
  scope: ClaudeAgentsScope,
  dependencies: ClaudeAgentsHandlerDependencies = {}
): Promise<ClaudeBackgroundAgentListResult> {
  const host = parseExecutionHostId(scope.executionHostId)
  if (host?.kind === 'runtime') {
    if (!scope.worktreeId) {
      return { status: 'ready', agents: [], details: {}, message: null }
    }
    const listRemote = dependencies.listRemote ?? listRemoteClaudeBackgroundAgents
    const userDataPath = await (dependencies.userDataPath ?? defaultUserDataPath)()
    return listRemote({
      userDataPath,
      environmentId: host.environmentId,
      worktreeId: scope.worktreeId
    })
  }
  if (host?.kind === 'ssh') {
    return { status: 'ready', agents: [], details: {}, message: null }
  }
  return buildClaudeBackgroundAgentListResult(
    () => (dependencies.listLocal ?? listClaudeBackgroundAgentsOrNull)(),
    (id) => (dependencies.readLocalDetail ?? readClaudeBackgroundAgentJobState)(id)
  )
}

/**
 * The activity lines for the agents in scope.
 *
 * The remote listing already read every state file, so its details come from that cache and send
 * no request at all — the panel asks again every two seconds.
 */
export async function readClaudeBackgroundAgentDetailsForScope(
  scope: ClaudeAgentsScope,
  ids: readonly string[],
  dependencies: ClaudeAgentsHandlerDependencies = {}
): Promise<Record<string, ClaudeBackgroundAgentDetail>> {
  const host = parseExecutionHostId(scope.executionHostId)
  if (host?.kind === 'runtime') {
    return (dependencies.readRemoteDetails ?? readRemoteClaudeBackgroundAgentDetails)(
      host.environmentId,
      ids
    )
  }
  if (host?.kind === 'ssh') {
    return {}
  }
  return readClaudeBackgroundAgentDetails(ids, (id) =>
    (dependencies.readLocalDetail ?? readClaudeBackgroundAgentJobState)(id)
  )
}

async function defaultUserDataPath(): Promise<string> {
  const { getRuntimeEnvironmentRegistryRoot } =
    await import('../runtime-environments/runtime-environment-registry-root')
  return getRuntimeEnvironmentRegistryRoot()
}

export function registerClaudeAgentsHandlers(
  dependencies: ClaudeAgentsHandlerDependencies = {}
): void {
  const dispatch = dependencies.dispatch ?? dispatchClaudeBackgroundAgent
  const stop = dependencies.stop ?? stopClaudeBackgroundAgent
  const remove = dependencies.remove ?? removeClaudeBackgroundAgent
  // Why: the panel keeps one dispatch on its way at a time, so one controller is enough; a module
  // level one would be shared by every registration and leak between tests.
  let inFlightDispatch: AbortController | null = null

  ipcMain.handle(
    'claudeAgents:list',
    (_event, scope: unknown): Promise<ClaudeBackgroundAgentListResult> =>
      buildClaudeBackgroundAgentListResultForScope(readClaudeAgentsScope(scope), dependencies)
  )
  // The fast poll asks only for the activity lines; the slow one asks the CLI for the roster.
  // The ids are checked against the CLI's short-id pattern inside readClaudeBackgroundAgentJobState,
  // before the id becomes a path segment, so this layer does not validate them a second time.
  ipcMain.handle(
    'claudeAgents:readDetails',
    (_event, ids: unknown, scope: unknown): Promise<Record<string, ClaudeBackgroundAgentDetail>> =>
      readClaudeBackgroundAgentDetailsForScope(
        readClaudeAgentsScope(scope),
        Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [],
        dependencies
      )
  )
  // The permission modes the CLI accepts and the `--` that keeps a prompt starting with a dash out
  // of the options both live in the command layer, so this layer only checks the shape of the
  // arguments the renderer sent.
  ipcMain.handle(
    'claudeAgents:dispatch',
    async (_event, args: unknown): Promise<ClaudeBackgroundAgentCommandResult> => {
      const prompt = readStringField(args, 'prompt')
      if (prompt === null || prompt.trim() === '') {
        return { ok: false, message: 'the dispatch needs a prompt' }
      }
      const controller = new AbortController()
      inFlightDispatch = controller
      try {
        return await dispatch(
          {
            prompt,
            cwd: readStringField(args, 'cwd'),
            model: readStringField(args, 'model'),
            permissionMode: readStringField(args, 'permissionMode')
          },
          { signal: controller.signal }
        )
      } finally {
        // Why: a second dispatch may have taken the slot; only its owner may give it back.
        if (inFlightDispatch === controller) {
          inFlightDispatch = null
        }
      }
    }
  )
  ipcMain.handle('claudeAgents:cancelDispatch', async (): Promise<void> => {
    // Why: `claude --bg` detaches the agent, so the only way to cancel it is to stop that process.
    inFlightDispatch?.abort()
  })
  ipcMain.handle(
    'claudeAgents:stop',
    async (_event, args: unknown): Promise<ClaudeBackgroundAgentCommandResult> => {
      const id = readStringField(args, 'id')
      if (id === null) {
        return { ok: false, message: 'the command needs an agent id' }
      }
      return stop({ id })
    }
  )
  ipcMain.handle(
    'claudeAgents:remove',
    async (_event, args: unknown): Promise<ClaudeBackgroundAgentCommandResult> => {
      const id = readStringField(args, 'id')
      if (id === null) {
        return { ok: false, message: 'the command needs an agent id' }
      }
      return remove({ id })
    }
  )
}

/**
 * One field of the arguments the renderer sent.
 *
 * The arguments cross the IPC boundary, so a malformed call has to read as a refusal rather than
 * as a raw TypeError.
 */
function readStringField(args: unknown, field: string): string | null {
  if (!isRecord(args)) {
    return null
  }
  const value = args[field]
  return typeof value === 'string' ? value : null
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
