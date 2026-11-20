import {
  isRecord,
  type ClaudeBackgroundAgent,
  type ClaudeBackgroundAgentDetail,
  type ClaudeBackgroundAgentState
} from '../../../shared/claude-background-agents'

const KNOWN_AGENT_STATES: readonly ClaudeBackgroundAgentState[] = [
  'working',
  'blocked',
  'done',
  'failed',
  'stopped'
]

/** Only an ISO timestamp is a timestamp; `Date.parse` would read '5' as a year. */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

export type RemoteJobAgent = {
  agent: ClaudeBackgroundAgent
  detail: ClaudeBackgroundAgentDetail
}

export type RemoteDirectoryEntry = {
  name: string
  isDirectory: boolean
  isSymlink: boolean
}

export type RemoteDirectoryBrowse = {
  resolvedPath: string
  pathFlavor: string
  entries: RemoteDirectoryEntry[]
}

/** A directory listing the paired host answered, or null when its shape is not one. */
export function readDirectoryBrowse(value: unknown): RemoteDirectoryBrowse | null {
  if (!isRecord(value) || typeof value.resolvedPath !== 'string' || !Array.isArray(value.entries)) {
    return null
  }
  const entries: RemoteDirectoryEntry[] = []
  for (const entry of value.entries) {
    if (!isRecord(entry) || typeof entry.name !== 'string') {
      continue
    }
    entries.push({
      name: entry.name,
      isDirectory: entry.isDirectory === true,
      isSymlink: entry.isSymlink === true
    })
  }
  return {
    resolvedPath: value.resolvedPath,
    pathFlavor: typeof value.pathFlavor === 'string' ? value.pathFlavor : '',
    entries
  }
}

/**
 * Joins a remote path with the remote's own separator.
 *
 * The local `path.join` would use the local separator and hand a macOS path to a Windows host;
 * the base is always the path the host resolved, and this only appends its own segments.
 */
export function joinRemotePath(pathFlavor: string, base: string, ...segments: string[]): string {
  const separator = pathFlavor === 'win32' ? '\\' : '/'
  let joined = base.replace(/[\\/]+$/, '')
  for (const segment of segments) {
    joined = `${joined}${separator}${segment.replace(/^[\\/]+/, '')}`
  }
  return joined
}

/** Whether the host said the directory does not exist, rather than failing for another reason. */
export function isMissingDirectoryMessage(message: string): boolean {
  return /ENOENT|no such file or directory|cannot find the (file|path)/i.test(message)
}

export async function mapWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  limit: number,
  read: (item: TItem) => Promise<TResult>
): Promise<TResult[]> {
  const results: TResult[] = []
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await read(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * One state file as the panel's row.
 *
 * `state.json` has no `startedAt` and no `kind`: the job's creation time is the start, and a job
 * that reached here is a background agent because only `template: 'bg'` is kept.
 */
export function mapRemoteJobState(
  jobId: string,
  state: Record<string, unknown>
): RemoteJobAgent | null {
  if (state.template !== 'bg') {
    return null
  }
  const sessionId = state.sessionId
  // Why: the panel's model requires a conversation id, so a job without one cannot be a row.
  if (typeof sessionId !== 'string' || sessionId === '') {
    return null
  }
  const agentState = KNOWN_AGENT_STATES.find((known) => known === state.state)
  const startedAt = readEpochMs(state.createdAt)
  const agent: ClaudeBackgroundAgent = {
    id: jobId,
    sessionId,
    name: typeof state.name === 'string' ? state.name : '',
    cwd: typeof state.cwd === 'string' ? state.cwd : '',
    kind: 'background',
    ...(startedAt === null ? {} : { startedAt }),
    // Why: an unknown state word is left absent, so the panel files the row under Completed.
    ...(agentState === undefined ? {} : { state: agentState })
  }
  return {
    agent,
    detail: {
      detail: typeof state.detail === 'string' ? state.detail : null,
      needs: typeof state.needs === 'string' ? state.needs : null,
      updatedAt: readEpochMs(state.updatedAt)
    }
  }
}

/** The CLI writes an ISO timestamp; an older job carries epoch ms. Both become epoch ms. */
function readEpochMs(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string' && ISO_TIMESTAMP.test(value)) {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

export function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
