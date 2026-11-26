import type { PluginHostResult } from '../../../../shared/plugins/workers/plugin-host-api'
import {
  PLUGIN_HOST_ID_MAX_LENGTH,
  PLUGIN_PROJECT_LIST_LIMIT,
  PLUGIN_WORKSPACE_LIST_LIMIT,
  pluginWorkspaceId
} from '../../../../shared/plugins/workers/plugin-host-api-workspace-methods'
import { folderWorkspaceKey } from '../../../../shared/workspace/identity/workspace-scope'
import { getRepoExecutionHostId } from '../../../../shared/execution-host/execution-host'
import { isRepoHidden } from '../../../../shared/project/catalog/hidden-projects'
import type { PluginRuntimeRpc } from './plugin-host-runtime-call'
import type { PluginHostServices } from './plugin-host-method-bindings'
import {
  pairedProjects,
  pairedWorkspaces,
  type PluginPairedHosts
} from './plugin-host-paired-hosts'
import {
  branchName,
  folderListAnswer,
  LABEL_MAX,
  projectListAnswer,
  repoListAnswer,
  worktreeListAnswer,
  worktreePsAnswer
} from './plugin-host-workspace-answers'

type WorkspaceList = PluginHostResult<'workspace.list'>
type WorkspaceStatus = NonNullable<WorkspaceList['workspaces'][number]['status']>

type WorkspaceStatuses = { byId: Map<string, WorkspaceStatus>; truncated: boolean }

/** Each workspace's status by the id `workspace.list` gives it. */
async function readWorkspaceStatuses(call: PluginRuntimeRpc): Promise<WorkspaceStatuses> {
  const { worktrees, totalCount, truncated } = worktreePsAnswer.parse(
    await call('worktree.ps', { limit: PLUGIN_WORKSPACE_LIST_LIMIT })
  )
  return {
    byId: new Map(
      worktrees.map((row) => [
        // Folder workspace rows carry their `folder:` key as worktreeId, as list rows do.
        pluginWorkspaceId({ id: row.worktreeId, identityKey: row.identity?.key }),
        {
          state: row.status,
          unread: row.unread,
          terminalCount: row.liveTerminalCount,
          lastActivityAt: row.lastOutputAt ?? row.lastActivityAt ?? null
        }
      ])
    ),
    truncated: truncated === true || (totalCount ?? worktrees.length) > worktrees.length
  }
}

export const PLUGIN_WORKSPACE_STATUS_TTL_MS = 1000
// Why shared: `worktree.ps` refreshes every terminal host, so plugins polling together share one
// listing in flight, however long it takes, and its answer for a second after it lands. Keyed by
// the runtime RPC it came from.
type StatusRead = { read: Promise<WorkspaceStatuses>; settledAt: number | null }
/** What the shared status listing is keyed by: the runtime RPC, or the services without one. */
export type PluginStatusListingOwner =
  | NonNullable<PluginHostServices['runtimeRpc']>
  | PluginHostServices
  | PluginRuntimeRpc
const statusReads = new WeakMap<PluginStatusListingOwner, StatusRead>()

function workspaceStatuses(
  call: PluginRuntimeRpc,
  source: PluginStatusListingOwner
): Promise<WorkspaceStatuses> {
  const cached = statusReads.get(source)
  if (
    cached &&
    (cached.settledAt === null || Date.now() - cached.settledAt < PLUGIN_WORKSPACE_STATUS_TTL_MS)
  ) {
    return cached.read
  }
  const entry: StatusRead = { read: readWorkspaceStatuses(call), settledAt: null }
  statusReads.set(source, entry)
  entry.read.then(
    () => {
      entry.settledAt = Date.now()
    },
    // A failed listing is not kept: the next call asks again.
    () => {
      if (statusReads.get(source) === entry) {
        statusReads.delete(source)
      }
    }
  )
  return entry.read
}

/** `project.list`'s host: `local` for this machine, else its `ssh:` or `runtime:` host. */
function projectHostId(repo: {
  executionHostId?: string | null
  connectionId?: string | null
}): string {
  return getRepoExecutionHostId(repo)
}

/** Whether a row's ids and path fit the public bounds; one that does not is left out. */
function fitsBounds(row: {
  id: string
  path: string
  hostId: string | null
  projectId?: string | null
}): boolean {
  return [row.id, row.path, row.hostId ?? '', row.projectId ?? ''].every(
    (value) => value.length <= PLUGIN_HOST_ID_MAX_LENGTH
  )
}

/**
 * `workspace.list`: Git worktrees (and folder projects), then project-group folders. With
 * `includeStatus`, each row Orca has a status for carries it. `statusSource` keys the shared
 * status listing (the runtime RPC the call came through).
 */
export async function listPluginWorkspaces(
  call: PluginRuntimeRpc,
  includeStatus: boolean,
  statusSource: PluginStatusListingOwner = call,
  pairedHosts?: PluginPairedHosts | null
): Promise<WorkspaceList> {
  const [listed, repos, folderList, statuses, paired] = await Promise.all([
    call('worktree.list', { limit: PLUGIN_WORKSPACE_LIST_LIMIT }),
    call('repo.list', {}),
    call('folderWorkspace.list', undefined),
    includeStatus ? workspaceStatuses(call, statusSource) : null,
    pairedWorkspaces(pairedHosts)
  ])
  const { worktrees, totalCount, truncated } = worktreeListAnswer.parse(listed)
  const repoRows = repoListAnswer.parse(repos).repos
  const reposById = new Map(repoRows.map((repo) => [repo.id, repo]))
  // Host ids keep the values host API 1.3 shipped: the row's recorded host, else null.
  const withStatus = <Row extends { id: string }>(row: Row) => {
    const status = statuses?.byId.get(row.id)
    return status ? { ...row, status } : row
  }
  const worktreeRows = worktrees.slice(0, PLUGIN_WORKSPACE_LIST_LIMIT).map((worktree) => {
    const repo = reposById.get(worktree.repoId)
    const folder = repo?.kind === 'folder'
    return withStatus({
      id: pluginWorkspaceId({ id: worktree.id, identityKey: worktree.identity?.key }),
      kind: folder ? ('folder' as const) : ('worktree' as const),
      name: worktree.displayName.slice(0, LABEL_MAX),
      project: repo?.displayName?.slice(0, LABEL_MAX) || null,
      projectId: worktree.repoId,
      path: worktree.path,
      branch: folder ? null : (branchName(worktree.branch)?.slice(0, LABEL_MAX) ?? null),
      hostId: worktree.hostId ?? null
    })
  })
  // Project-group folders have no repo row; their key is what selectors take.
  const projectFolders = folderListAnswer.parse(folderList).folderWorkspaces.map((folder) =>
    withStatus({
      id: folderWorkspaceKey(folder.id),
      kind: 'folder' as const,
      name: folder.name.slice(0, LABEL_MAX),
      project: null,
      projectId: null,
      path: folder.folderPath,
      branch: null,
      hostId: folder.executionHostId ?? null
    })
  )
  const room = PLUGIN_WORKSPACE_LIST_LIMIT - worktreeRows.length
  const candidates = [...worktreeRows, ...projectFolders.slice(0, room), ...paired]
  const workspaces = candidates.filter(fitsBounds)
  return {
    workspaces,
    truncated:
      truncated === true ||
      (totalCount ?? worktrees.length) > worktreeRows.length ||
      projectFolders.length > room ||
      workspaces.length < candidates.length,
    ...(statuses
      ? { statusTruncated: statuses.truncated && workspaces.some((row) => !('status' in row)) }
      : {})
  }
}

/** `project.list`: the repositories and folders `repo.list` shows, which hides retired rows. */
export async function listPluginProjects(
  call: PluginRuntimeRpc,
  pairedHosts?: PluginPairedHosts | null
): Promise<PluginHostResult<'project.list'>> {
  const [local, paired] = await Promise.all([call('repo.list', {}), pairedProjects(pairedHosts)])
  const { repos } = projectListAnswer.parse(local)
  const candidates = repos.slice(0, PLUGIN_PROJECT_LIST_LIMIT).map((repo) => ({
    id: repo.id,
    name: (repo.displayName ?? '').slice(0, LABEL_MAX),
    kind: repo.kind === 'folder' ? ('folder' as const) : ('git' as const),
    hostId: projectHostId(repo),
    path: repo.path,
    hidden: isRepoHidden(repo)
  }))
  const all = [...candidates, ...paired]
  const projects = all
    .filter((project) => project.id.length > 0 && fitsBounds(project))
    .slice(0, PLUGIN_PROJECT_LIST_LIMIT)
  return {
    projects,
    truncated: repos.length > PLUGIN_PROJECT_LIST_LIMIT || projects.length < all.length
  }
}
