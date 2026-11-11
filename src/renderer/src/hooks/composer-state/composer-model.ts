import type { ComposerAsyncModel } from './async-model'
import type { ComposerDerivedModel } from './derived-model'
import type { ComposerIdentityModel } from './identity-model'
import type { ComposerInitialTargetModel } from './initial-target-model'
import type { ComposerProviderSyncModel } from './provider-sync-model'
import type { ComposerRuntimeTargetModel } from './runtime-target-model'
import type { ComposerSourceContextModel } from './source-context-model'
import type { ComposerSourceModel } from './composer-source-model'
import type { ComposerSubmitModel } from './composer-submit-model'
import type { ComposerTargetStoreModel } from './target-store-model'
import type { Worktree } from '../../../../shared/worktree/types'

export type ComposerTargetModel = ComposerTargetStoreModel &
  ComposerInitialTargetModel &
  ComposerRuntimeTargetModel &
  ComposerSourceContextModel &
  ComposerIdentityModel &
  ComposerAsyncModel &
  ComposerProviderSyncModel &
  ComposerDerivedModel

export type ComposerModel = ComposerTargetModel & ComposerSourceModel & ComposerSubmitModel

export type QuickCreationExecutionInput = Pick<
  ComposerModel,
  | 'checkoutTarget'
  | 'clearNewWorkspaceDraft'
  | 'createMultiple'
  | 'effectivePresetId'
  | 'ephemeralVmRecipes'
  | 'ephemeralVmsEnabled'
  | 'isSubmissionCancelled'
  | 'linkedGitLabIssue'
  | 'linkedGitLabMR'
  | 'normalizedSparseDirectories'
  | 'onCreated'
  | 'parentWorktreeId'
  | 'persistDraft'
  | 'persistSetupAgentStartupPolicy'
  | 'prepareQuickSubmit'
  | 'resetForNextCreate'
  | 'resolvedInitialWorkspaceStatus'
  | 'selectedEphemeralVmRecipeId'
  | 'selectedRepoAgentLaunchFact'
  | 'selectedRepoExecutionHostId'
  | 'selectedRepoIsGit'
  | 'selectedRepoIsRemote'
  | 'selectedRepoTarget'
  | 'selectedRepoStartupShell'
  | 'selectedWorkspaceTarget'
  | 'settings'
  | 'sparseEnabled'
  | 'taskSourceContext'
  | 'telemetrySource'
> & {
  /** Resolves a repo's workspace records at submit time, through the catalog selector. */
  resolveRepoWorktrees: (repoId: string) => Worktree[]
}
