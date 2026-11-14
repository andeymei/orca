import { splitWorktreeIdForFilesystem } from '../../../../shared/worktree/id'
import {
  createRepoRowExecutionHostLookup,
  type RepoRowExecutionHostLookup
} from '../../../../shared/execution-host/worktree-execution-host-resolution'
import type { Repo } from '../../../../shared/repo-types'
import { areWorktreePathsEqual } from '../../../git/worktrees/catalog/worktree-path-comparison'
import { mergeWorktree } from '../../../ipc/worktree-metadata-merge'
import { resolveWorktreeMetaOwner } from '../../../persistence/host-qualified-worktree-meta'
import type { RuntimeStore } from '../../construction/runtime-store-contract'
import type { ResolvedWorktree } from './runtime-worktree-path-identity'

/**
 * Rebuild a checkout row from its id when the live catalog no longer lists it.
 *
 * The id carries the repo and the checkout path, so the row can be restored without the
 * catalog; the owner still decides which host owns it.
 */
export function buildResolvedWorktreeFromId(
  store: RuntimeStore | null,
  worktreeId: string,
  repos: RepoRowExecutionHostLookup<Repo> = createRepoRowExecutionHostLookup(
    store?.getRepos() ?? []
  )
): ResolvedWorktree | null {
  const parsed = splitWorktreeIdForFilesystem(worktreeId)
  if (!parsed?.repoId || !parsed.worktreePath) {
    return null
  }
  const owner = store && resolveWorktreeMetaOwner(store, worktreeId, repos)
  if (!owner) {
    return null
  }
  const repo = repos.byHost(parsed.repoId, owner.hostId)
  const git = {
    path: parsed.worktreePath,
    head: '',
    branch: '',
    isBare: false,
    isMainWorktree: repo ? areWorktreePathsEqual(parsed.worktreePath, repo.path) : false
  }
  const meta = store?.getWorktreeMeta(worktreeId)
  const merged = {
    ...mergeWorktree(parsed.repoId, git, meta, repo?.displayName),
    hostId: owner.hostId
  }
  return {
    ...merged,
    id: worktreeId,
    parentWorktreeId: null,
    childWorktreeIds: [],
    lineage: null,
    git,
    displayName: merged.displayName,
    comment: merged.comment
  }
}
