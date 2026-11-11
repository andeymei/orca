import type { ComposerModel } from './composer-model'
import { getCurrentCheckoutBranchForRepo } from '@/lib/workspace/creation/current-checkout-worktree'
import type { TaskCheckoutTarget } from '../../../../shared/new-workspace/task-checkout-target'

export type ComposerCheckoutTargetProps = {
  checkoutTarget: TaskCheckoutTarget
  onCheckoutTargetChange: (next: TaskCheckoutTarget) => void
  currentCheckoutBranch: string | null
}

/** The composer's two checkout modes share one branch, so their props travel together. */
export function buildComposerCheckoutTargetProps(
  state: ComposerModel,
  isProjectGroupTarget: boolean
): ComposerCheckoutTargetProps {
  if (isProjectGroupTarget) {
    return {
      checkoutTarget: 'new-workspace',
      onCheckoutTargetChange: () => {},
      currentCheckoutBranch: null
    }
  }
  return {
    checkoutTarget: state.checkoutTarget,
    onCheckoutTargetChange: state.setCheckoutTarget,
    currentCheckoutBranch: getCurrentCheckoutBranchForRepo(
      state.worktreesByRepo[state.repoId] ?? [],
      state.repoId
    )
  }
}
