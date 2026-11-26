import { decideAgentLaunchIntentMode } from '../../../../agent-launch/agent-launch-intent-mode'
/** Resolve selectors and validate terminal reuse without creating a surface. */

import type {
  AgentLaunchIntent,
  AgentLaunchTarget,
  AgentLaunchModeReceipt
} from '../../../../../shared/agent-launch/contracts/agent-launch-intent'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import { assertTerminalLaunchAdmissible } from '../../../../agent-launch/agent-launch-surface-factories'
import type { AgentLaunchParams } from '../../../../../shared/rpc-contract/agent-launch/agent-launch-params'
import { resolveAgentLaunchModeOnHost } from '../../../../agent-launch/agent-launch-mode'

import type { EarlyAgentLaunchTab } from './agent-launch-tab-publication'

type ResolvedAgentLaunchIntent = Omit<AgentLaunchIntent, 'sessionOptions'> & {
  sessionOptions?: Readonly<NonNullable<AgentLaunchParams['sessionOptions']>>
}

/** Resolve the selector once to avoid id:id: prefixes below the executor.
 * Use launch scope: floating workspaces have no Git worktree record, and folder rows are synthetic. */
async function agentLaunchTarget(
  params: AgentLaunchParams,
  runtime: Pick<OrcaRuntimeService, 'showTerminalWorkspaceLaunchScope'>
): Promise<AgentLaunchTarget> {
  if (params.target.kind !== 'existing') {
    return { kind: params.target.kind, create: { ...params.target.create } }
  }
  const workspace = await runtime.showTerminalWorkspaceLaunchScope(params.target.worktree)
  return {
    kind: 'existing',
    worktree: workspace.id,
    workspacePath: workspace.path,
    connectionId: workspace.connectionId
  }
}

async function agentLaunchIntent(
  params: AgentLaunchParams,
  runtime: OrcaRuntimeService,
  /** The pane of a tab already shown for this launch; the spawn must land in it. */
  publishedPaneKey: string | undefined
): Promise<ResolvedAgentLaunchIntent> {
  const paneKey = publishedPaneKey ?? params.paneKey
  return {
    agent: params.agent,
    target: await agentLaunchTarget(params, runtime),
    ...(params.prompt ? { prompt: params.prompt } : {}),
    ...(params.sessionOptions ? { sessionOptions: params.sessionOptions } : {}),
    ...(params.chatOptions ? { chatOptions: params.chatOptions } : {}),
    ...(params.reuseTerminal ? { reuseTerminal: params.reuseTerminal } : {}),
    // `null` means "no arguments" and must survive; only absence falls back to the settings default.
    ...(params.agentArgs !== undefined ? { agentArgs: params.agentArgs } : {}),
    ...(params.cwd ? { cwd: params.cwd } : {}),
    ...(params.launchSource ? { launchSource: params.launchSource } : {}),
    ...(paneKey ? { paneKey } : {}),
    ...(params.sessionId ? { sessionId: params.sessionId } : {}),
    ...(params.accountEnv ? { accountEnv: params.accountEnv } : {}),
    ...(params.nativeChatDefault !== undefined
      ? { nativeChatDefault: params.nativeChatDefault }
      : {}),
    ...(params.surface ? { surface: params.surface } : {})
  }
}

/**
 * How long a reused terminal may still be starting its agent before the reuse is refused.
 *
 * A caller that launches an agent and then sends it a prompt reuses the terminal it was given:
 * the agent is still starting then, and refusing that reuse drops the prompt on the floor.
 */
export const REUSED_TERMINAL_AGENT_READY_TIMEOUT_MS = 30_000
const REUSED_TERMINAL_AGENT_POLL_MS = 500

/** What the reuse check reads: the terminal's workspace, and whether its agent is running. */
export type ReusedTerminalRuntime = {
  showTerminal(handle: string): Promise<{ worktreeId: string }>
  isTerminalRunningAgent(handle: string): Promise<boolean>
}

/** The clock the readiness wait reads, so a test can run it without waiting. */
export type ReusedTerminalReadinessClock = {
  now(): number
  sleep(ms: number): Promise<void>
}

const REAL_CLOCK: ReusedTerminalReadinessClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Whether the terminal runs the agent yet.
 *
 * A terminal whose agent is still starting does not: the foreground process is the shell's, not
 * the agent's. The wait ends when the agent proves itself, when the caller gives up, or when the
 * budget runs out.
 */
async function waitForReusedTerminalAgent(
  handle: string,
  runtime: Pick<ReusedTerminalRuntime, 'isTerminalRunningAgent'>,
  signal: AbortSignal | undefined,
  clock: ReusedTerminalReadinessClock
): Promise<boolean> {
  const deadline = clock.now() + REUSED_TERMINAL_AGENT_READY_TIMEOUT_MS
  for (;;) {
    if (await runtime.isTerminalRunningAgent(handle)) {
      return true
    }
    if (signal?.aborted || clock.now() >= deadline) {
      return false
    }
    await clock.sleep(REUSED_TERMINAL_AGENT_POLL_MS)
  }
}

export async function validateReusedTerminal(
  intent: AgentLaunchIntent,
  runtime: ReusedTerminalRuntime,
  signal?: AbortSignal,
  clock: ReusedTerminalReadinessClock = REAL_CLOCK
): Promise<void> {
  if (!intent.reuseTerminal) {
    return
  }
  if (intent.target.kind !== 'existing') {
    throw new Error('agent_launch_reuse_requires_existing_workspace')
  }
  const terminal = await runtime.showTerminal(intent.reuseTerminal.handle)
  if (terminal.worktreeId !== intent.target.worktree) {
    throw new Error('agent_launch_terminal_worktree_mismatch')
  }
  if (!(await waitForReusedTerminalAgent(intent.reuseTerminal.handle, runtime, signal, clock))) {
    throw new Error('agent_launch_terminal_not_running_agent')
  }
}

/** Resolve and validate before creation so a throw proves failed rather than unknown in the ledger. */
export async function resolveUnlaunchedIntent(
  params: AgentLaunchParams,
  runtime: OrcaRuntimeService,
  early: EarlyAgentLaunchTab | null,
  modeOptions: {
    terminalOnly?: boolean
    callerRendersStructured?: boolean
    /** The caller's own cancellation: a wait for a starting agent ends with it. */
    signal?: AbortSignal
  } = {}
): Promise<{ intent: ResolvedAgentLaunchIntent; decidedMode: AgentLaunchModeReceipt }> {
  const intent = await agentLaunchIntent(params, runtime, early?.paneKey)
  await validateReusedTerminal(intent, runtime, modeOptions.signal)
  const preflight = decideAgentLaunchIntentMode({ intent, runtime, ...modeOptions })
  const decidedMode =
    intent.target.kind === 'existing'
      ? await resolveAgentLaunchModeOnHost(
          runtime,
          preflight,
          intent.target.worktree,
          intent.agent,
          undefined,
          {
            phase: 'before-effects',
            agent: intent.agent,
            workspacePath: intent.target.workspacePath,
            cwd: intent.cwd
          }
        )
      : preflight
  assertTerminalLaunchAdmissible(intent, decidedMode.mode)
  return { intent, decidedMode }
}
