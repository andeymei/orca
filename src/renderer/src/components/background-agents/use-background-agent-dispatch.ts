import { useRef } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store/index'
import { selectWorktreesByRepo } from '@/store/workspaces/catalog/workspace-record-fields'
import { findFirstIndexedWorktree } from '@/lib/workspace/ownership/worktree-runtime-owner-index'
import type { BackgroundAgentsDispatch } from '@/store/slices/background-agents/create-background-agents-slice'
import { CLAUDE_BACKGROUND_AGENT_CANCELLED_MESSAGE } from '../../../../shared/claude-background-agents'
import { refreshBackgroundAgentRoster } from './use-background-agent-roster-refresh'

/** How long the "started" row stays before it disappears on its own. */
const STARTED_ROW_LIFETIME_MS = 2000

export type BackgroundAgentDispatchControls = {
  /** The placeholder row the panel draws, when a dispatch is on its way. */
  dispatch: BackgroundAgentsDispatch | null
  /** Starts a background agent. Only one may be on its way at a time. */
  dispatchPrompt: (prompt: string) => Promise<boolean>
  /** Asks the main side to abort the dispatch that is still opening. */
  cancelOpeningDispatch: () => void
}

/**
 * Starts the agent and settles the placeholder row from the CLI's answer.
 *
 * It lives outside the hook because the React Compiler cannot compile a `try`/`finally`.
 */
async function dispatchBackgroundAgent(args: {
  prompt: string
  /** Whether the user asked for this dispatch to be aborted. */
  cancelled: () => boolean
  publish: (dispatch: BackgroundAgentsDispatch | null) => void
  /** Called once the dispatch has settled, whether it came up or not. */
  settled: () => void
}): Promise<boolean> {
  try {
    const state = useAppStore.getState()
    const cwd = state.activeWorktreeId
      ? findFirstIndexedWorktree(selectWorktreesByRepo(state), state.activeWorktreeId)?.path
      : undefined
    const result = await window.api.claudeAgents.dispatch(
      cwd ? { prompt: args.prompt, cwd } : { prompt: args.prompt }
    )
    if (result.ok) {
      if (args.cancelled()) {
        // The CLI won the race against the cancel, so the agent exists; saying otherwise would lie.
        args.publish({ state: 'started', agentId: result.id, message: null })
        setTimeout(() => {
          args.publish(null)
        }, STARTED_ROW_LIFETIME_MS)
      } else {
        args.publish(null)
      }
      // Why: the agent the user just asked for must not wait for the next poll to show up.
      await refreshBackgroundAgentRoster()
      return true
    }
    if (args.cancelled() && result.message === CLAUDE_BACKGROUND_AGENT_CANCELLED_MESSAGE) {
      // Nothing came up: the row goes away. The roster may still find an agent the CLI printed
      // an id for before the abort landed, which is the price of cancelling a dispatch.
      args.publish(null)
      await refreshBackgroundAgentRoster()
      return false
    }
    args.publish({ state: 'failed', agentId: null, message: result.message })
    toast.error(result.message)
    return false
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    args.publish({ state: 'failed', agentId: null, message })
    toast.error(message)
    return false
  } finally {
    args.settled()
  }
}

/**
 * The dispatch that is on its way.
 *
 * Its state lives in the store, because the sidebar unmounts the panel when the user switches
 * tabs, and a local state would take the placeholder row with it.
 */
export function useBackgroundAgentDispatch(): BackgroundAgentDispatchControls {
  const dispatch = useAppStore((state) => state.backgroundAgentsDispatch)
  const publishBackgroundAgentsDispatch = useAppStore(
    (state) => state.publishBackgroundAgentsDispatch
  )
  const inFlightRef = useRef(false)
  const cancelRequestedRef = useRef(false)

  /** Starts a background agent; it answers whether the agent came up. */
  const dispatchPrompt = async (prompt: string): Promise<boolean> => {
    if (inFlightRef.current || dispatch?.state === 'opening') {
      // Why: the main side remembers one dispatch at a time; a second one would displace the first.
      return false
    }
    inFlightRef.current = true
    cancelRequestedRef.current = false
    publishBackgroundAgentsDispatch({ state: 'opening', agentId: null, message: null })
    return dispatchBackgroundAgent({
      prompt,
      cancelled: () => cancelRequestedRef.current,
      publish: publishBackgroundAgentsDispatch,
      settled: () => {
        inFlightRef.current = false
      }
    })
  }

  const cancelOpeningDispatch = (): void => {
    if (cancelRequestedRef.current) {
      return
    }
    cancelRequestedRef.current = true
    // Why: the abort only delivers the signal; the row waits for the dispatch to settle.
    void window.api.claudeAgents.cancelDispatch()
  }

  return { dispatch, dispatchPrompt, cancelOpeningDispatch }
}
