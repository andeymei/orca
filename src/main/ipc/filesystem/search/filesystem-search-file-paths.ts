import { sep } from 'node:path'
import type { RuntimeStore } from '../../../runtime/construction/runtime-store-contract'
import { fileListingCancellationError } from '../../../../shared/file-listing/file-listing-cancellation'
import {
  buildExcludePathPrefixes,
  buildRgArgsForQuickOpen
} from '../../../../shared/quick-open/quick-open-filter'
import {
  isQuickOpenQueryTooLarge,
  QuickOpenPathRanker
} from '../../../../shared/quick-open/quick-open-path-search'
import {
  RipgrepLaunchFailureError,
  RipgrepUnavailableError
} from '../../../../shared/ripgrep/ripgrep-process-availability'
import { resolveBundledRipgrepWslRouting } from '../../../ripgrep/bundled-ripgrep-wsl-routing'
import { resolveAuthorizedPath } from '../access/filesystem-auth'
import { getLocalGitOptionsForRegisteredWorktree } from '../../worktrees/local-worktree-runtime-options'
import { bundledRipgrepUnavailableError } from '../../../ripgrep/bundled-ripgrep-path'
import { scanIgnoredFilesWhenNeeded } from './quick-open-ignored-pass-policy'
import { scanRipgrepPaths } from './filesystem-scan-ripgrep-paths'

export type QuickOpenFilePathSearchResult = {
  paths: string[]
  totalCount: number
  truncated: boolean
}

export async function searchQuickOpenFilePaths(
  rootPath: string,
  store: RuntimeStore,
  args: {
    includeIgnored?: boolean
    followSymlinks?: boolean
    query: string
    limit: number
    excludePaths?: string[]
    signal?: AbortSignal
  }
): Promise<QuickOpenFilePathSearchResult> {
  if (args.limit <= 0 || !args.query.trim() || isQuickOpenQueryTooLarge(args.query)) {
    return { paths: [], totalCount: 0, truncated: false }
  }
  const authorizedRootPath = await resolveAuthorizedPath(rootPath, store)
  const localGitOptions = getLocalGitOptionsForRegisteredWorktree(
    store,
    rootPath,
    authorizedRootPath
  )
  const { wslDistro, wslDistroForOutput } = resolveBundledRipgrepWslRouting(
    authorizedRootPath,
    localGitOptions.wslDistro,
    { followSymlinks: args.followSymlinks }
  )

  const excludePathPrefixes = [
    ...new Set([
      ...buildExcludePathPrefixes(rootPath, args.excludePaths),
      ...buildExcludePathPrefixes(authorizedRootPath, args.excludePaths)
    ])
  ]
  const { primary, ignoredPass } = buildRgArgsForQuickOpen({
    searchRoot: '.',
    followSymlinks: args.followSymlinks,
    excludePathPrefixes,
    forceSlashSeparator: sep === '\\'
  })
  // Fresh ranker per attempt so a retry cannot double-count paths from the aborted scan.
  const scanOnce = async (): Promise<QuickOpenFilePathSearchResult> => {
    const ranker = new QuickOpenPathRanker(args.query, args.limit)
    // The tracked scan respects .gitignore and walks far less of the tree than the ignored scan.
    await scanRipgrepPaths({
      args: primary,
      authorizedRootPath,
      excludePathPrefixes,
      wslDistro,
      ranker,
      signal: args.signal,
      wslDistroForOutput
    })
    const ignored = await scanIgnoredFilesWhenNeeded({
      includeIgnored: args.includeIgnored,
      limit: args.limit,
      ranker,
      signal: args.signal,
      scan: () =>
        scanRipgrepPaths({
          args: ignoredPass,
          authorizedRootPath,
          excludePathPrefixes,
          wslDistro,
          ranker,
          signal: args.signal,
          wslDistroForOutput
        })
    })
    const result = ranker.result()
    return { ...result, truncated: ignored.failed || result.totalCount > args.limit }
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await scanOnce()
    } catch (error) {
      if (error instanceof RipgrepUnavailableError) {
        throw bundledRipgrepUnavailableError()
      }
      // Superseding aborts still owe cancellation after a scan rejection.
      if (args.signal?.aborted) {
        throw fileListingCancellationError(args.signal)
      }
      // Retry transient fork/exec pressure so Quick Open need not wait for another query.
      if (!(error instanceof RipgrepLaunchFailureError) || attempt > 0) {
        throw error
      }
    }
  }
  throw new Error('unreachable Quick Open retry state')
}
