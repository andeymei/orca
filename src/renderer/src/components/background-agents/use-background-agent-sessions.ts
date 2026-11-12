import { useCallback, useEffect, useState } from 'react'
import { callStructuredAgentSession } from '@/runtime/native-chat/requests/structured-agent-session-call'
import { RuntimeRpcCallError } from '@/runtime/rpc/calls/runtime-rpc-result'
import type { AgentSessionBackgroundSession } from '../../../../shared/agent-session/lifecycle/agent-session-background-session'

export type BackgroundAgentSessionsState =
  | { state: 'loading' }
  | { state: 'ready'; sessions: readonly AgentSessionBackgroundSession[] }
  /** This host does not answer the list, so there is nothing to offer. */
  | { state: 'unsupported' }

type BackgroundAgentSessionsPayload = { sessions?: AgentSessionBackgroundSession[] }

/** Older hosts answer nothing for this read; the picker then stays out of the way. */
export async function readBackgroundAgentSessions(): Promise<BackgroundAgentSessionsState> {
  try {
    const payload = await callStructuredAgentSession<BackgroundAgentSessionsPayload>(
      { kind: 'local' },
      'agentSession.backgroundList'
    )
    return {
      state: 'ready',
      sessions: Array.isArray(payload.sessions) ? payload.sessions : []
    }
  } catch (error) {
    if (error instanceof RuntimeRpcCallError && error.code === 'method_not_found') {
      return { state: 'unsupported' }
    }
    return { state: 'ready', sessions: [] }
  }
}

/** The list is read when the picker opens, not before: it changes as chats come and go. */
export function useBackgroundAgentSessions(open: boolean): {
  state: BackgroundAgentSessionsState
  reload: () => void
} {
  const [state, setState] = useState<BackgroundAgentSessionsState>({ state: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)

  const reload = useCallback(() => setReloadToken((token) => token + 1), [])

  useEffect(() => {
    if (!open) {
      return
    }
    let live = true
    setState({ state: 'loading' })
    void readBackgroundAgentSessions().then((next) => {
      if (live) {
        setState(next)
      }
    })
    return () => {
      live = false
    }
  }, [open, reloadToken])

  return { state, reload }
}
