import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { findCurrentCheckoutWorktree } from '@/lib/workspace/creation/current-checkout-worktree'
import { launchTaskInCurrentCheckout } from '@/lib/workspace/creation/launch-task-in-current-checkout'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import type { Worktree } from '../../../../shared/worktree/types'

export type CurrentCheckoutSubmit = {
  repoId: string
  worktrees: readonly Worktree[]
  agent: TuiAgent | null
  prompt: string | null
  promptDelivery: 'auto-submit' | 'draft'
  persistDraft: boolean
  clearNewWorkspaceDraft: () => void
  onCreated?: () => void
}

/**
 * Run the task in the repo's own checkout instead of creating a worktree and a branch.
 * True means the submit finished here; false means the repo has no checkout to run in.
 */
export function submitTaskInCurrentCheckout(submit: CurrentCheckoutSubmit): boolean {
  const currentCheckout = findCurrentCheckoutWorktree(submit.worktrees, submit.repoId)
  if (!currentCheckout) {
    return false
  }
  const launched = launchTaskInCurrentCheckout({
    worktree: currentCheckout,
    agent: submit.agent,
    prompt: submit.prompt,
    promptDelivery: submit.promptDelivery
  })
  if (!launched) {
    toast.error(
      translate(
        'auto.hooks.composerState.currentCheckoutLaunchFailed',
        'Could not start the task in this project’s current checkout.'
      )
    )
    return true
  }
  if (submit.persistDraft) {
    submit.clearNewWorkspaceDraft()
  }
  submit.onCreated?.()
  return true
}
