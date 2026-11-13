import { useCallback, useEffect, useState } from 'react'
import { callStructuredAgentSession } from '@/runtime/native-chat/requests/structured-agent-session-call'
import { RuntimeRpcCallError } from '@/runtime/rpc/calls/runtime-rpc-result'
import type { AgentSessionBackgroundSession } from '../../../../shared/agent-session/lifecycle/agent-session-background-session'
import type { AgentSessionBackgroundTerminal } from '../../../../shared/agent-session/lifecycle/agent-session-background-terminal'
import {
  boundedAiVaultScopeArgs,
  type AiVaultSession
} from '../../../../shared/ai-vault/contracts/ai-vault-types'
import { useAppStore } from '@/store/index'
import type { AppState } from '@/store/types'
import {
  backgroundAgentTerminalRows,
  type BackgroundAgentTerminalTab
} from './background-agent-terminal-rows'
import {
  aiVaultSessionWorkspace,
  BACKGROUND_AGENT_VAULT_LIMIT,
  backgroundAgentVaultRows
} from './background-agent-vault-rows'
import { getAiVaultResumeWorkspaceExecutionHostId } from '@/lib/agent-session/resume/history/ai-vault-resume-target'
import { resolveAiVaultHostScopeDefaults } from '@/components/right-sidebar/ai-vault/scope/ai-vault-host-scope'
import {
  canOpenAiVaultSessionInOrca,
  isAiVaultSessionOpenInOrca
} from './background-agent-vault-resume'
import {
  createBackgroundAgentScopeMatcher,
  resolveBackgroundAgentWorkspaceScope,
  type BackgroundAgentWorkspaceScope
} from './background-agent-workspace-scope'
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
  const state = useAppStore.getState()
  const scope = resolveBackgroundAgentWorkspaceScope(state)
  const vaultSessions = await readBackgroundAgentVaultSessions(state, scope)
  const rows: BackgroundAgentRow[] = [
    ...chats
      .filter((chat) => chat.workspaceId === scope.workspaceId)
      .map((chat): BackgroundAgentRow => ({
        kind: 'chat',
        chat,
        workspace: { id: chat.workspaceId, label: chat.workspaceId }
      })),
    ...readBackgroundAgentTerminals(state, scope.workspaceId).map(
      (terminal): BackgroundAgentRow => ({
        kind: 'terminal',
        terminal,
        workspace: { id: terminal.workspaceId, label: terminal.workspaceId }
      })
    ),
    ...vaultSessions.map((vault): BackgroundAgentRow => ({
      kind: 'vault',
      vault,
      workspace: aiVaultSessionWorkspace(state, vault)
    }))
  ]
  return { state: 'ready', rows }
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

/** The terminal tabs of one workspace, each with the live title its agent is named by. */
function backgroundAgentTerminalTabs(
  state: AppState,
  workspaceId: string | null
): BackgroundAgentTerminalTab[] {
  const tabs: BackgroundAgentTerminalTab[] = []
  for (const [worktreeId, unifiedTabs] of Object.entries(state.unifiedTabsByWorktree)) {
    if (worktreeId !== workspaceId) {
      continue
    }
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
function readBackgroundAgentTerminals(
  state: AppState,
  workspaceId: string | null
): AgentSessionBackgroundTerminal[] {
  return backgroundAgentTerminalRows(
    backgroundAgentTerminalTabs(state, workspaceId),
    visibleTabId(state)
  )
}

/**
 * The agent sessions this workspace has; the AI Vault indexes the ones that ran outside Orca.
 *
 * A remote workspace must see its own host's history, not this machine's: the panel follows the
 * workspace the user is in, so a remote project's list is the remote host's. The host is asked for
 * the workspace's own directories, and the rows are checked against them, so a session that ran
 * somewhere else on that host stays out of the list.
 */
async function readBackgroundAgentVaultSessions(
  state: AppState,
  scope: BackgroundAgentWorkspaceScope
): Promise<AiVaultSession[]> {
  // Without the workspace's directories there is nothing to claim as its session, so the host is
  // never asked for an unscoped list.
  if (scope.scopePaths.length === 0) {
    return []
  }
  try {
    const activeExecutionHostId = getAiVaultResumeWorkspaceExecutionHostId(
      state,
      state.activeWorktreeId
    )
    const { defaultExecutionHostScope } = resolveAiVaultHostScopeDefaults(
      activeExecutionHostId,
      state.activeWorktreeId
    )
    const result = await window.api.aiVault.listSessions({
      limit: BACKGROUND_AGENT_VAULT_LIMIT,
      executionHostScope: defaultExecutionHostScope,
      ...boundedAiVaultScopeArgs(scope.scopePaths, true)
    })
    const inScope = createBackgroundAgentScopeMatcher(scope.scopePaths)
    return backgroundAgentVaultRows(
      result.sessions,
      (session) =>
        inScope(session) &&
        canOpenAiVaultSessionInOrca(state, session) &&
        !isAiVaultSessionOpenInOrca(state, session)
    )
  } catch {
    return []
  }
}

/** The list is read when the panel opens, not before: it changes as chats come and go. */
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
