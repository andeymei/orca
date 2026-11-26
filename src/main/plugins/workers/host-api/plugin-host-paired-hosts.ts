import type { PluginHostResult } from '../../../../shared/plugins/workers/plugin-host-api'
import { PLUGIN_WORKSPACE_LIST_LIMIT } from '../../../../shared/plugins/workers/plugin-host-api-workspace-methods'
import { isRecord } from '../../../../shared/agent-status/child-work/agent-status-child-work-value-guards'
import { isRepoHidden } from '../../../../shared/project/catalog/hidden-projects'
import { PluginHostCallError } from './plugin-host-call-scope'
import {
  branchName,
  LABEL_MAX,
  pairedWorktreeAnswer,
  projectListAnswer
} from './plugin-host-workspace-answers'

type WorkspaceList = PluginHostResult<'workspace.list'>
type ProjectRow = PluginHostResult<'project.list'>['projects'][number]
type WorkspaceRow = WorkspaceList['workspaces'][number]

/**
 * The servers this desktop is paired with.
 *
 * A paired server is a host Orca reaches: its workspaces and its projects belong on the same
 * list as this machine's, and `workspace.list` promises every host. The plugin host asks the
 * servers the way the sidebar does — over the relay, one server at a time.
 */
export type PluginPairedHosts = {
  /** The paired servers, by environment id. */
  list(): Promise<readonly string[]>
  /** Calls a runtime method on one server; null when it cannot be reached. */
  call(environmentId: string, method: string, params: unknown): Promise<unknown>
}

/** The host id a paired server's rows carry: the server itself, not the host under it. */
const PAIRED_HOST_PREFIX = 'runtime:'

function pairedHostId(environmentId: string): `runtime:${string}` {
  return `${PAIRED_HOST_PREFIX}${environmentId}`
}

/**
 * A method's answer on one paired server, or null when the server could not answer.
 *
 * A server that is asleep, unreachable or answering something else contributes nothing: the
 * listing of the other hosts still stands.
 */
async function callPaired(
  pairedHosts: PluginPairedHosts,
  environmentId: string,
  method: string,
  params: unknown
): Promise<unknown> {
  try {
    const answer = await pairedHosts.call(environmentId, method, params)
    if (!isRecord(answer)) {
      return null
    }
    return answer['ok'] === true ? answer['result'] : null
  } catch {
    return null
  }
}

/** The repositories of the paired servers, as the plugin names them. */
async function readPairedProjects(pairedHosts: PluginPairedHosts): Promise<ProjectRow[]> {
  const projects: ProjectRow[] = []
  for (const environmentId of await pairedHosts.list()) {
    const answer = await callPaired(pairedHosts, environmentId, 'repo.list', {})
    const parsed = projectListAnswer.safeParse(answer)
    if (!parsed.success) {
      continue
    }
    for (const repo of parsed.data.repos) {
      projects.push({
        id: repo.id,
        name: (repo.displayName ?? '').slice(0, LABEL_MAX),
        kind: repo.kind === 'folder' ? ('folder' as const) : ('git' as const),
        // The server is the host: the project lives there, whatever host of that server holds it.
        hostId: pairedHostId(environmentId),
        path: repo.path,
        hidden: isRepoHidden(repo)
      })
    }
  }
  return projects
}

/** The workspaces of the paired servers, as the plugin names them. */
async function readPairedWorkspaces(pairedHosts: PluginPairedHosts): Promise<WorkspaceRow[]> {
  const workspaces: WorkspaceRow[] = []
  for (const environmentId of await pairedHosts.list()) {
    const answer = await callPaired(pairedHosts, environmentId, 'worktree.ps', {
      limit: PLUGIN_WORKSPACE_LIST_LIMIT
    })
    const parsed = pairedWorktreeAnswer.safeParse(answer)
    if (!parsed.success) {
      continue
    }
    for (const worktree of parsed.data.worktrees) {
      workspaces.push({
        // The server's own id, as the desktop's paired rows and the focused context name it:
        // the identity form is the server's to give, and this side never sees one.
        id: worktree.worktreeId,
        kind:
          worktree.workspaceKind === 'folder-workspace'
            ? ('folder' as const)
            : ('worktree' as const),
        name: (worktree.displayName || worktree.repo || worktree.path).slice(0, LABEL_MAX),
        project: worktree.repo || null,
        projectId: worktree.repoId,
        path: worktree.path,
        branch: branchName(worktree.branch)?.slice(0, LABEL_MAX) ?? null,
        // The server is the host: the workspace lives there, whatever host of that server holds it.
        hostId: pairedHostId(environmentId)
      })
    }
  }
  return workspaces
}

/**
 * How long a paired server's rows are reused before it is asked again.
 *
 * Asking costs a round trip over the relay, and a server answers `worktree.ps` by refreshing
 * every terminal host it has. Plugins that read the lists together share one answer for a
 * second, the way the status listing does.
 */
const PAIRED_ROWS_TTL_MS = 1000

type RowsRead<Row> = { read: Promise<Row[]>; settledAt: number | null }

/** One shared answer for a paired server's rows. */
function sharedRows<Row>(
  cache: WeakMap<PluginPairedHosts, RowsRead<Row>>,
  pairedHosts: PluginPairedHosts,
  read: () => Promise<Row[]>
): Promise<Row[]> {
  const cached = cache.get(pairedHosts)
  if (cached && (cached.settledAt === null || Date.now() - cached.settledAt < PAIRED_ROWS_TTL_MS)) {
    return cached.read
  }
  const entry: RowsRead<Row> = { read: read(), settledAt: null }
  cache.set(pairedHosts, entry)
  entry.read.then(
    () => {
      entry.settledAt = Date.now()
    },
    // A failed listing is not kept: the next call asks again.
    () => {
      if (cache.get(pairedHosts) === entry) {
        cache.delete(pairedHosts)
      }
    }
  )
  return entry.read
}

const projectReads = new WeakMap<PluginPairedHosts, RowsRead<ProjectRow>>()
const workspaceReads = new WeakMap<PluginPairedHosts, RowsRead<WorkspaceRow>>()

/** The projects of the paired servers, as the plugin names them. */
export function pairedProjects(
  pairedHosts: PluginPairedHosts | null | undefined
): Promise<ProjectRow[]> {
  if (!pairedHosts) {
    return Promise.resolve([])
  }
  return sharedRows(projectReads, pairedHosts, () => readPairedProjects(pairedHosts))
}

/** The workspaces of the paired servers, as the plugin names them. */
export function pairedWorkspaces(
  pairedHosts: PluginPairedHosts | null | undefined
): Promise<WorkspaceRow[]> {
  if (!pairedHosts) {
    return Promise.resolve([])
  }
  return sharedRows(workspaceReads, pairedHosts, () => readPairedWorkspaces(pairedHosts))
}

/**
 * The paired server that holds a workspace, or null when this machine holds it.
 *
 * The rows carry the server's own worktree ids, so the id a plugin passes names that server's
 * workspace directly. The work there belongs to that server: an agent launched for it has to run
 * there, in that server's own workspace.
 */
export async function pairedEnvironmentOf(
  pairedHosts: PluginPairedHosts | null | undefined,
  workspaceId: string
): Promise<string | null> {
  if (!pairedHosts) {
    return null
  }
  const row = (await pairedWorkspaces(pairedHosts)).find((entry) => entry.id === workspaceId)
  const hostId = row?.hostId ?? null
  if (hostId === null || !hostId.startsWith(PAIRED_HOST_PREFIX)) {
    return null
  }
  return hostId.slice(PAIRED_HOST_PREFIX.length)
}

/**
 * A runtime method on one paired server.
 *
 * The desktop reaches the server over the paired runtime socket, and the server does the work in
 * its own world — its own terminals, its own agents, its own files. A refusal comes back as the
 * plugin sees any other one: a fixed message, with the server's wording in the detail.
 */
export async function pairedRuntimeCall(
  pairedHosts: PluginPairedHosts,
  environmentId: string,
  method: string,
  params: unknown
): Promise<unknown> {
  let answer: unknown
  try {
    answer = await pairedHosts.call(environmentId, method, params)
  } catch (error) {
    throw new PluginHostCallError(
      'unavailable',
      'the server that holds this workspace could not be reached',
      undefined,
      error instanceof Error ? error.message : String(error)
    )
  }
  if (!isRecord(answer)) {
    throw new PluginHostCallError(
      'unavailable',
      'the server that holds this workspace did not answer'
    )
  }
  if (answer['ok'] !== true) {
    const error = answer['error']
    const detail =
      isRecord(error) && typeof error['message'] === 'string' ? error['message'] : undefined
    throw new PluginHostCallError(
      'action_failed',
      'the server that holds this workspace refused the action',
      undefined,
      detail
    )
  }
  return answer['result']
}
