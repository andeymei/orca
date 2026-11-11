import type { ComposerModel } from './composer-model'
import {
  getCurrentCheckoutBranchForRepo,
  resolveEffectiveCheckoutTarget
} from '@/lib/workspace/creation/current-checkout-worktree'
import { selectWorktreesByRepo } from '@/store/workspaces/catalog/workspace-record-fields'
import { useAppStore } from '@/store'
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
  const worktrees = selectWorktreesByRepo(useAppStore.getState())[state.repoId] ?? []
  return {
    checkoutTarget: resolveEffectiveCheckoutTarget({
      checkoutTarget: state.checkoutTarget,
      worktrees,
      repoId: state.repoId
    }),
    onCheckoutTargetChange: state.setCheckoutTarget,
    currentCheckoutBranch: getCurrentCheckoutBranchForRepo(worktrees, state.repoId)
  }
}
