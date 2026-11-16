import { useEffect } from 'react'
import { useAppStore } from '@/store/index'

/** How often the roster is read again; the CLI's own listing is slow to answer. */
const ROSTER_REFRESH_INTERVAL_MS = 15_000

/**
 * Reads the roster from the CLI and hands it to the store.
 *
 * A poll that fails leaves the roster the user is looking at alone; only the CLI answering
 * "there is none here" empties it.
 */
export async function refreshBackgroundAgentRoster(): Promise<void> {
  try {
    const result = await window.api.claudeAgents.list()
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
  useEffect(() => {
    void refreshBackgroundAgentRoster()
    const timer = setInterval(() => {
      void refreshBackgroundAgentRoster()
    }, ROSTER_REFRESH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])
}
