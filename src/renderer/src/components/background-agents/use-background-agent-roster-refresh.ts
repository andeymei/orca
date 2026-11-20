import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store/index'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import type { ClaudeAgentsScope } from '../../../../shared/claude-background-agents'

/** How often the roster is read again from this machine; the CLI's own listing is slow to answer. */
const LOCAL_ROSTER_REFRESH_INTERVAL_MS = 15_000

/**
 * How often a paired host's roster is read again.
 *
 * A remote listing reads every job's state file (a whole-host sweep measured at ~4.8 s), so the
 * panel asks far less often; the job count only makes that sweep slower.
 */
const REMOTE_ROSTER_REFRESH_INTERVAL_MS = 60_000

/** The interval the host at this id needs; only `runtime:` hosts pay for a file sweep. */
export function backgroundAgentRosterRefreshIntervalMs(executionHostId: string | null): number {
  return parseExecutionHostId(executionHostId)?.kind === 'runtime'
    ? REMOTE_ROSTER_REFRESH_INTERVAL_MS
    : LOCAL_ROSTER_REFRESH_INTERVAL_MS
}

function currentClaudeAgentsScope(): ClaudeAgentsScope {
  const state = useAppStore.getState()
  return {
    worktreeId: state.activeWorktreeId,
    executionHostId: state.activeWorkspaceExecutionHostId
  }
}

/**
 * Reads the roster and hands it to the store.
 *
 * A poll that fails leaves the roster the user is looking at alone; only the host answering
 * "there is none here" empties it.
 */
export async function refreshBackgroundAgentRoster(
  scope: ClaudeAgentsScope = currentClaudeAgentsScope()
): Promise<void> {
  try {
    const result = await window.api.claudeAgents.list(scope)
    useAppStore.getState().publishBackgroundAgentsListing(result)
  } catch {
    // The next poll tries again; the rows stay as they are.
  }
}

/**
 * Refreshes the roster (the slow layer). Both screens call it; only one is mounted at a time.
 *
 * The detail screen needs it too: its header shows the agent's own state, and a roster that only
 * the list screen polled would freeze that header the moment the user entered an agent.
 */
export function useBackgroundAgentRosterRefresh(): void {
  const worktreeId = useAppStore((state) => state.activeWorktreeId)
  const executionHostId = useAppStore((state) => state.activeWorkspaceExecutionHostId)
  // Why a ref: switching workspaces must not restart the interval, but the next tick has to ask
  // for the workspace the user is in now.
  const scopeRef = useRef<ClaudeAgentsScope>({ worktreeId, executionHostId })
  useEffect(() => {
    scopeRef.current = { worktreeId, executionHostId }
  }, [worktreeId, executionHostId])

  useEffect(() => {
    // Why: the poll pauses while the window is hidden and reads again when it comes back.
    // The host is a dependency: switching to a paired host must read its roster at once instead
    // of waiting for the previous host's cadence.
    return installWindowVisibilityInterval({
      run: () => {
        void refreshBackgroundAgentRoster(scopeRef.current)
      },
      intervalMs: backgroundAgentRosterRefreshIntervalMs(executionHostId)
    })
  }, [executionHostId])
}
