import { launchAgentInNewTabWithOutcome } from '@/lib/agent-session/launch/new-tab/launch-agent-in-new-tab'
import { activateAndRevealWorktreeWithOutcome } from '@/lib/workspace/activation/worktree-activation'
import { reportAgentWorkspaceActivation } from '@/lib/workspace/activation/worktree-activation-outcome'
import { resolveRepoWorktreeLaunchPlatform } from '@/runtime/hosts/platform/execution-host-facts'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store/index'
import { createNonSecureContextUuid } from '../../../../../shared/non-secure-context-uuid'
import type { TuiAgent } from '../../../../../shared/agent-launch/catalog/tui-agent'
import type { Worktree } from '../../../../../shared/worktree/types'

export type CurrentCheckoutTaskLaunch = {
  worktree: Worktree
  agent: TuiAgent | null
  prompt: string | null
  promptDelivery: 'auto-submit' | 'draft'
}

/**
 * Run a task in the repo's own checkout instead of creating a worktree and a branch.
 * The branch stays whatever the checkout already has; the agent decides whether it needs its own branch.
 */
export function launchTaskInCurrentCheckout(task: CurrentCheckoutTaskLaunch): boolean {
  const { worktree, agent, prompt } = task
  const state = useAppStore.getState()
  const repo = state.repos.find((candidate) => candidate.id === worktree.repoId)
  const launchPlatform = repo ? resolveRepoWorktreeLaunchPlatform(state, repo, worktree) : undefined
  if (!agent) {
    return 'opened' in activateAndRevealWorktreeWithOutcome(worktree.id)
  }
  let revealFailed = false
  const result = launchAgentInNewTabWithOutcome({
    requestId: createNonSecureContextUuid(),
    agent,
    worktreeId: worktree.id,
    groupId: worktree.id,
    prompt: prompt ?? undefined,
    promptDelivery: task.promptDelivery,
    launchPlatform,
    launchSource: 'new_workspace_composer',
    beforeSurfaceOpen: () => {
      // Why: the launcher owns the initial surface, so revealing must not seed a sibling shell.
      const revealed = activateAndRevealWorktreeWithOutcome(worktree.id, {
        providesInitialSurface: true
      })
      revealFailed = !reportAgentWorkspaceActivation(
        revealed,
        agent,
        translate(
          'auto.lib.workspace.creation.current.checkout.activationFailed',
          'Unable to open this project’s current checkout.'
        )
      )
      return !revealFailed
    }
  })
  if (!result || 'refused' in result) {
    return false
  }
  return !revealFailed
}
