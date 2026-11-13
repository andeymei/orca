import type { AiVaultSession } from '../../../../shared/ai-vault/contracts/ai-vault-types'
import type { AppState } from '@/store/types'
import { useAppStore } from '@/store/index'
import { activateAndRevealWorkspace } from '@/lib/workspace/activation/worktree-activation'
import { activateTabAndFocusPane } from '@/lib/workspace/tabs/activate-tab-and-focus-pane'
import { findStructuredAgentSessionTab } from '@/lib/agent-session/structured-agent-session-tab-activation'
import {
  buildAiVaultResumeStartupForWorktree,
  resolveAiVaultResumeHost
} from '@/lib/agent-session/resume/history/ai-vault-resume-command'
import { prepareAiVaultSessionForTerminalResume } from '@/lib/agent-session/resume/history/ai-vault-session-resume-preparation'
import { launchAiVaultSessionAndReveal } from '@/lib/agent-session/resume/history/launch-ai-vault-session-and-reveal'
import { describeAiVaultResumeFailure } from '@/lib/agent-session/resume/history/ai-vault-resume-refusal'
import { findOriginalAiVaultSessionPane } from '@/components/right-sidebar/ai-vault/session-actions/ai-vault-original-pane'
import {
  notifyAiVaultSessionPreparationFailure,
  resolveAiVaultSessionLaunchTargetOrNotify
} from '@/components/right-sidebar/ai-vault/session-actions/ai-vault-session-launch-feedback'
import { resolveAiVaultSessionLaunchTarget } from '@/components/right-sidebar/ai-vault/session-actions/ai-vault-session-launch-target'
import { buildClaudeAttachStartup } from '../../../../shared/ai-vault/resume/ai-vault-attach-startup'
import type { ClaudeBackgroundAgent } from '../../../../shared/claude-background-agents'
import { aiVaultSessionWorkspace } from './background-agent-vault-rows'
import { runningAgentForSession } from './background-agent-running-session'

/** Orca already shows this session: it has a pane, or its chat tab is open. */
export function isAiVaultSessionOpenInOrca(state: AppState, session: AiVaultSession): boolean {
  const structured = session.structuredSession
  if (
    structured &&
    findStructuredAgentSessionTab(state.unifiedTabsByWorktree, {
      workspaceId: structured.workspaceId,
      sessionId: structured.sessionId
    })
  ) {
    return true
  }
  return findOriginalAiVaultSessionPane(state, session) !== null
}

/** Orca can bring this session back: a pane runs it, or its own workspace can resume it. */
export function canOpenAiVaultSessionInOrca(state: AppState, session: AiVaultSession): boolean {
  if (findOriginalAiVaultSessionPane(state, session)) {
    return true
  }
  const workspace = aiVaultSessionWorkspace(state, session)
  if (!workspace.id) {
    return false
  }
  return (
    resolveAiVaultSessionLaunchTarget({
      sessionFilePath: session.filePath,
      sessionExecutionHostId: session.executionHostId,
      activeWorktreeId: state.activeWorktreeId,
      targetWorktreeId: workspace.id,
      targetState: state
    }).status === 'ready'
  )
}

/**
 * The agent running this conversation, when it runs on this machine.
 *
 * A conversation that is already running must be opened, not resumed: the CLI copies a resumed
 * conversation that has a live writer, and the copy is the second, same-named agent the user
 * finds afterwards.
 */
async function findRunningAgent(session: AiVaultSession): Promise<ClaudeBackgroundAgent | null> {
  // Only Claude Code lists background agents; the matcher owns the rule, this skips the call.
  if (session.agent !== 'claude') {
    return null
  }
  try {
    const agents = await window.api.aiVault.listRunningAgents()
    return runningAgentForSession(agents, session)
  } catch {
    return null
  }
}

/**
 * Bring the session back: the pane that already runs it, or a terminal that resumes it.
 *
 * A session whose agent runs outside Orca has no pane to jump to, so it resumes in the
 * workspace it was recorded in — the same action the AI Vault's own resume button takes.
 */
export async function openBackgroundAgentSession(session: AiVaultSession): Promise<void> {
  const state = useAppStore.getState()
  const pane = findOriginalAiVaultSessionPane(state, session)
  if (pane) {
    activateAndRevealWorkspace(pane.worktreeId)
    useAppStore.getState().setActiveTabType('terminal', pane.worktreeId)
    activateTabAndFocusPane(pane.tabId, pane.leafId, {
      flashFocusedPane: true,
      scrollToBottomIfOutputSinceLastView: true
    })
    return
  }
  const workspace = aiVaultSessionWorkspace(state, session)
  const target = resolveAiVaultSessionLaunchTargetOrNotify({
    sessionFilePath: session.filePath,
    sessionExecutionHostId: session.executionHostId,
    activeWorktreeId: state.activeWorktreeId,
    targetWorktreeId: workspace.id ?? undefined,
    targetState: state
  })
  if (!target) {
    return
  }
  const describeFailure = (message: string): string =>
    describeAiVaultResumeFailure(new Error(message), session.agent)
  try {
    const running = await findRunningAgent(session)
    if (running) {
      const host = resolveAiVaultResumeHost({
        state: useAppStore.getState(),
        worktreeId: target.worktreeId,
        session
      })
      const startup = buildClaudeAttachStartup({
        platform: host.platform,
        shell: host.liveShell,
        agentId: running.id,
        cwd: session.cwd ?? null
      })
      await launchAiVaultSessionAndReveal(
        { agent: session.agent, worktreeId: target.worktreeId, ...startup },
        describeFailure
      )
      return
    }
    const prepared = await prepareAiVaultSessionForTerminalResume(session)
    const startup = buildAiVaultResumeStartupForWorktree({
      state: useAppStore.getState(),
      worktreeId: target.worktreeId,
      session: prepared
    })
    await launchAiVaultSessionAndReveal(
      { agent: session.agent, worktreeId: target.worktreeId, ...startup },
      describeFailure
    )
  } catch (error) {
    notifyAiVaultSessionPreparationFailure(error, session.agent, describeFailure)
  }
}
