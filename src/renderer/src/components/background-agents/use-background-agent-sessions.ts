import { useCallback, useEffect, useState } from 'react'
import { callStructuredAgentSession } from '@/runtime/native-chat/requests/structured-agent-session-call'
import { RuntimeRpcCallError } from '@/runtime/rpc/calls/runtime-rpc-result'
import type { AgentSessionBackgroundSession } from '../../../../shared/agent-session/lifecycle/agent-session-background-session'
import type { AgentSessionBackgroundTerminal } from '../../../../shared/agent-session/lifecycle/agent-session-background-terminal'
import { useAppStore } from '@/store/index'
import type { AppState } from '@/store/types'
import {
  backgroundAgentTerminalRows,
  type BackgroundAgentTerminalTab
} from './background-agent-terminal-rows'
import type { BackgroundAgentRow } from './background-agent-session-list'

export type BackgroundAgentSessionsState =
  | { state: 'loading' }
  | { state: 'ready'; rows: readonly BackgroundAgentRow[] }
  /** This host does not answer the list, so there is nothing to offer. */
  | { state: 'unsupported' }

type BackgroundAgentSessionsPayload = { sessions?: AgentSessionBackgroundSession[] }

/** Older hosts answer nothing for this read; the picker then stays out of the way. */
export async function readBackgroundAgentSessions(): Promise<BackgroundAgentSessionsState> {
  let chats: AgentSessionBackgroundSession[] = []
  try {
    const payload = await callStructuredAgentSession<BackgroundAgentSessionsPayload>(
      { kind: 'local' },
      'agentSession.backgroundList'
    )
    chats = Array.isArray(payload.sessions) ? payload.sessions : []
  } catch (error) {
    if (error instanceof RuntimeRpcCallError && error.code === 'method_not_found') {
      return { state: 'unsupported' }
    }
  }
  const terminals = readBackgroundAgentTerminals()
  return {
    state: 'ready',
    rows: [
      ...chats.map((chat): BackgroundAgentRow => ({ kind: 'chat', chat })),
      ...terminals.map((terminal): BackgroundAgentRow => ({ kind: 'terminal', terminal }))
    ]
  }
}

/** The tab the user is looking at, so the picker does not offer what is already on screen. */
function visibleTabId(state: AppState): string | null {
  const worktreeId = state.activeWorktreeId
  if (!worktreeId) {
    return null
  }
  const groups = state.groupsByWorktree[worktreeId] ?? []
  const activeGroupId = state.activeGroupIdByWorktree[worktreeId]
  const group = groups.find((candidate) => candidate.id === activeGroupId) ?? groups[0]
  return group?.activeTabId ?? null
}

/** The terminal tabs of every workspace, each with the live title its agent is named by. */
function backgroundAgentTerminalTabs(state: AppState): BackgroundAgentTerminalTab[] {
  const tabs: BackgroundAgentTerminalTab[] = []
  for (const [worktreeId, unifiedTabs] of Object.entries(state.unifiedTabsByWorktree)) {
    const terminalTabs = state.tabsByWorktree[worktreeId] ?? []
    for (const tab of unifiedTabs) {
      if (tab.contentType !== 'terminal') {
        continue
      }
      const liveTitle = terminalTabs.find((candidate) => candidate.id === tab.entityId)?.title
      tabs.push({
        tabId: tab.id,
        worktreeId,
        ...(tab.executionHostId ? { executionHostId: tab.executionHostId } : {}),
        title: liveTitle ?? tab.label
      })
    }
  }
  return tabs
}

/** The terminals running an agent; a workspace without one offers none. */
function readBackgroundAgentTerminals(): AgentSessionBackgroundTerminal[] {
  const state = useAppStore.getState()
  return backgroundAgentTerminalRows(backgroundAgentTerminalTabs(state), visibleTabId(state))
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
