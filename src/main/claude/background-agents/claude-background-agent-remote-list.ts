import {
  CLAUDE_BACKGROUND_AGENT_ID_PATTERN,
  isRecord,
  type ClaudeBackgroundAgent,
  type ClaudeBackgroundAgentDetail,
  type ClaudeBackgroundAgentListResult
} from '../../../shared/claude-background-agents'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import type { callRuntimeEnvironment } from '../../ipc/runtime-environments/runtime-environment-transport-routing'
import {
  isMissingDirectoryMessage,
  joinRemotePath,
  mapRemoteJobState,
  mapWithConcurrency,
  readDirectoryBrowse,
  readErrorMessage,
  type RemoteJobAgent
} from './claude-background-agent-remote-state'

/** The remote's own job directory: `~/.claude/jobs`, one directory per agent. */
const REMOTE_CLAUDE_DIR = '.claude'
const REMOTE_JOBS_DIR = 'jobs'
const REMOTE_STATE_FILE = 'state.json'

/** The remote answers one resolve+read pair in ~50 ms; a few in flight keep the sweep around a second. */
const JOB_READ_CONCURRENCY = 8

type RuntimeCall = typeof callRuntimeEnvironment

type RemoteHome = {
  /** The path the remote reported, in its own separator style. */
  resolvedPath: string
  pathFlavor: string
}

/**
 * The remote home is asked for once per paired environment: it cannot change under a pairing,
 * and every poll would otherwise pay an extra round trip for it.
 */
const remoteHomes = new Map<string, RemoteHome>()

/**
 * The details the last listings read.
 *
 * A remote listing already reads every state file, so the panel's fast detail poll is answered
 * from here instead of sending a request per agent per poll. Keyed by environment, then agent id.
 */
const remoteDetailsByEnvironment = new Map<string, Map<string, ClaudeBackgroundAgentDetail>>()

/**
 * A call to the paired runtime.
 *
 * Why `callRuntimeEnvironment` and nothing hand-rolled: terminal file grants are bound to the
 * device's clientId and are revoked when the device's last connection closes. A one-shot socket
 * per call gets `terminal_file_grant_expired`; `callRuntimeEnvironment` goes through the
 * persistent shared-control connection, so a grant minted by the resolve is still alive when the
 * read follows. `src/main/ipc/runtime-environments/runtime-environment-shared-control-envelope.ts`
 * is what decides that route.
 */
async function callDefaultRuntimeEnvironment(
  ...args: Parameters<RuntimeCall>
): Promise<RuntimeRpcResponse<unknown>> {
  const { callRuntimeEnvironment: call } =
    await import('../../ipc/runtime-environments/runtime-environment-transport-routing')
  return call(...args)
}

type RuntimeRpcCall = (method: string, params: unknown) => Promise<RuntimeRpcResponse<unknown>>

function createRuntimeRpcCall(
  userDataPath: string,
  environmentId: string,
  injected: RuntimeCall | undefined
): RuntimeRpcCall {
  const call = injected ?? callDefaultRuntimeEnvironment
  return (method, params) => call(userDataPath, environmentId, method, params)
}

export type RemoteClaudeBackgroundAgentListArgs = {
  /** The runtime environment registry root, i.e. the app's userData directory. */
  userDataPath: string
  /** The paired environment id, without its `runtime:` prefix. */
  environmentId: string
  /** A worktree on the remote host; any of its worktrees can resolve an absolute path there. */
  worktreeId: string
  /** Injected so tests exercise the mapping without a paired machine. */
  call?: RuntimeCall
}

/**
 * The Claude Code background agents on a paired host, as its `~/.claude/jobs` files describe them.
 *
 * Read-only by design: only the RPC methods 1.4.253 already serves are used (`browseServerDir`,
 * `resolveTerminalPath`, `readTerminalArtifact`), so the paired machine needs no update.
 */
export async function listRemoteClaudeBackgroundAgents(
  args: RemoteClaudeBackgroundAgentListArgs
): Promise<ClaudeBackgroundAgentListResult> {
  const call = createRuntimeRpcCall(args.userDataPath, args.environmentId, args.call)
  try {
    const home = await readRemoteHome(call, args.environmentId)
    const jobs = await listRemoteJobDirectories(call, home)
    if (!jobs.ok) {
      // Why: a host with no `.claude/jobs` has no background agents yet; anything else is a failure.
      return jobs.missing
        ? readyResult([], {})
        : errorResult(`could not read the background agents directory: ${jobs.message}`)
    }
    const jobAgents = await readRemoteJobAgents(call, args.worktreeId, home, jobs.directories)
    const details = new Map<string, ClaudeBackgroundAgentDetail>()
    for (const { agent, detail } of jobAgents) {
      details.set(agent.id, detail)
    }
    remoteDetailsByEnvironment.set(args.environmentId, details)
    return readyResult(
      jobAgents.map(({ agent }) => agent),
      Object.fromEntries(details)
    )
  } catch (error) {
    return errorResult(readErrorMessage(error))
  }
}

/**
 * The activity lines for agents a previous listing saw.
 *
 * The remote path deliberately sends no request: the listing that found the agents already read
 * their state files, and the panel asks for these lines every two seconds.
 */
export function readRemoteClaudeBackgroundAgentDetails(
  environmentId: string,
  ids: readonly string[]
): Record<string, ClaudeBackgroundAgentDetail> {
  const cached = remoteDetailsByEnvironment.get(environmentId)
  if (!cached) {
    return {}
  }
  const details: Record<string, ClaudeBackgroundAgentDetail> = {}
  for (const id of ids) {
    const detail = cached.get(id)
    if (detail) {
      details[id] = detail
    }
  }
  return details
}

/** Forgets the per-environment caches; a test uses this instead of depending on order. */
export function resetRemoteClaudeBackgroundAgentCachesForTests(): void {
  remoteHomes.clear()
  remoteDetailsByEnvironment.clear()
}

async function readRemoteHome(call: RuntimeRpcCall, environmentId: string): Promise<RemoteHome> {
  const cached = remoteHomes.get(environmentId)
  if (cached) {
    return cached
  }
  const response = await call('files.browseServerDir', { path: '~' })
  const home = response.ok ? readDirectoryBrowse(response.result) : null
  if (!home) {
    throw new Error(
      response.ok
        ? 'the paired machine returned no home directory'
        : `the paired machine could not report its home directory: ${response.error.message}`
    )
  }
  const resolved: RemoteHome = {
    resolvedPath: home.resolvedPath,
    pathFlavor: home.pathFlavor
  }
  remoteHomes.set(environmentId, resolved)
  return resolved
}

type RemoteJobDirectories =
  | { ok: true; directories: string[] }
  | { ok: false; missing: boolean; message: string }

async function listRemoteJobDirectories(
  call: RuntimeRpcCall,
  home: RemoteHome
): Promise<RemoteJobDirectories> {
  const response = await call('files.browseServerDir', {
    path: joinRemotePath(home.pathFlavor, home.resolvedPath, REMOTE_CLAUDE_DIR, REMOTE_JOBS_DIR)
  })
  if (!response.ok) {
    return {
      ok: false,
      missing: isMissingDirectoryMessage(response.error.message),
      message: response.error.message
    }
  }
  const browse = readDirectoryBrowse(response.result)
  if (!browse) {
    return { ok: false, missing: false, message: 'the paired machine returned no job listing' }
  }
  return {
    ok: true,
    directories: browse.entries
      .filter((entry) => entry.isDirectory && CLAUDE_BACKGROUND_AGENT_ID_PATTERN.test(entry.name))
      .map((entry) => entry.name)
  }
}

/**
 * Every job directory's state file, read a few at a time.
 *
 * One job the host cannot answer for is skipped, never allowed to fail the whole roster: a
 * cleaned-up directory or a file the daemon is rewriting is normal.
 */
async function readRemoteJobAgents(
  call: RuntimeRpcCall,
  worktreeId: string,
  home: RemoteHome,
  directories: readonly string[]
): Promise<RemoteJobAgent[]> {
  const jobsPath = joinRemotePath(
    home.pathFlavor,
    home.resolvedPath,
    REMOTE_CLAUDE_DIR,
    REMOTE_JOBS_DIR
  )
  const readOne = async (directory: string): Promise<RemoteJobAgent | null> => {
    try {
      const statePath = joinRemotePath(home.pathFlavor, jobsPath, directory, REMOTE_STATE_FILE)
      const state = await readRemoteJobState(call, worktreeId, statePath)
      return state ? mapRemoteJobState(directory, state) : null
    } catch {
      // Why: a grant that lapsed or a file gone between browse and read is skipped until next poll.
      return null
    }
  }
  const agents = await mapWithConcurrency(directories, JOB_READ_CONCURRENCY, readOne)
  return agents.filter((agent): agent is RemoteJobAgent => agent !== null)
}

async function readRemoteJobState(
  call: RuntimeRpcCall,
  worktreeId: string,
  statePath: string
): Promise<Record<string, unknown> | null> {
  const resolution = await call('files.resolveTerminalPath', {
    worktree: worktreeId,
    pathText: statePath
  })
  if (!resolution.ok || !isRecord(resolution.result)) {
    return null
  }
  const openTarget = resolution.result.openTarget
  if (!isRecord(openTarget) || openTarget.kind !== 'absolute-file') {
    return null
  }
  const grantId = openTarget.grantId
  if (typeof grantId !== 'string' || grantId === '') {
    return null
  }
  const read = await call('files.readTerminalArtifact', {
    worktree: worktreeId,
    grantId,
    absolutePath: typeof openTarget.absolutePath === 'string' ? openTarget.absolutePath : statePath
  })
  if (!read.ok || !isRecord(read.result) || typeof read.result.content !== 'string') {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(read.result.content)
  } catch {
    return null
  }
  return isRecord(parsed) ? parsed : null
}

function readyResult(
  agents: ClaudeBackgroundAgent[],
  details: Record<string, ClaudeBackgroundAgentDetail>
): ClaudeBackgroundAgentListResult {
  return { status: 'ready', agents, details, message: null }
}

function errorResult(message: string): ClaudeBackgroundAgentListResult {
  return { status: 'error', agents: [], details: {}, message }
}
