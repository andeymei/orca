import { z } from 'zod'

/**
 * What a runtime answers the plugin host with.
 *
 * Only the parts the workspace and project lists read are kept; the rest is dropped. The paired
 * servers answer the same methods, so their rows are read with the same shapes.
 */

/** A label the plugin shows: the longest one a row may carry. */
export const LABEL_MAX = 512

/** The parts of each runtime answer `workspace.list` and `project.list` read; the rest is dropped. */
export const worktreeListAnswer = z.object({
  worktrees: z.array(
    z.object({
      id: z.string(),
      repoId: z.string(),
      displayName: z.string(),
      path: z.string(),
      branch: z.string().optional(),
      hostId: z.string().optional(),
      identity: z.object({ key: z.string() }).optional()
    })
  ),
  totalCount: z.number().optional(),
  truncated: z.boolean().optional()
})

// The rows a paired server answers with: its worktrees, seen from the other side.
export const pairedWorktreeAnswer = z.object({
  worktrees: z.array(
    z.object({
      worktreeId: z.string(),
      repoId: z.string(),
      path: z.string(),
      branch: z.string().optional(),
      displayName: z.string().optional(),
      repo: z.string().optional(),
      workspaceKind: z.string().optional()
    })
  )
})

export const repoRow = z.object({
  id: z.string(),
  kind: z.string().optional(),
  displayName: z.string().optional(),
  executionHostId: z.string().nullable().optional(),
  connectionId: z.string().nullable().optional()
})

export const repoListAnswer = z.object({ repos: z.array(repoRow) })

export const projectListAnswer = z.object({
  repos: z.array(
    // A malformed `hiddenAt` reads as shown, as Orca's sidebar reads it, not as a failed list.
    repoRow.extend({ path: z.string(), hiddenAt: z.number().optional().catch(undefined) })
  )
})

export const folderListAnswer = z.object({
  folderWorkspaces: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      folderPath: z.string(),
      executionHostId: z.string().nullable().optional(),
      connectionId: z.string().nullable().optional()
    })
  )
})

export const worktreePsAnswer = z.object({
  worktrees: z.array(
    z.object({
      worktreeId: z.string(),
      identity: z.object({ key: z.string() }).optional(),
      status: z.enum(['working', 'permission', 'done', 'active', 'inactive']),
      unread: z.boolean(),
      liveTerminalCount: z.number().int().nonnegative(),
      lastOutputAt: z.number().finite().nullable().optional(),
      lastActivityAt: z.number().finite().optional()
    })
  ),
  totalCount: z.number().optional(),
  truncated: z.boolean().optional()
})

/** `refs/heads/main` reads as `main`; a detached or folder workspace has none. */
export function branchName(branch: string | undefined): string | null {
  const name = branch?.replace(/^refs\/heads\//, '') ?? ''
  return name || null
}
