import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { defineMethod } from '../../core'
import {
  RefactorApplyParams,
  RefactorJobIdParams,
  RefactorProposeParams,
  type RefactorApplyResult,
  type RefactorDiscardResult,
  type RefactorPlanResult,
  type RefactorProposeResult,
  type RefactorStatusResult
} from '../../../../../shared/rpc-contract/refactor-params'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../../shared/execution-host/execution-host'
import { buildRefactorPrompt } from '../../../../../shared/refactor/refactor-prompt'
import type { FileWriteDiskConflict } from '../../../../../shared/file-write/file-write-disk-precondition'
import { resolveTuiAgentLaunchEnv } from '../../../../../shared/agent-launch/choices/tui-agent-launch-defaults'
import { applyRefactorSelection } from '../../../../refactor/refactor-apply'
import {
  listScratchProposals,
  readScratchFile,
  readWorkspaceFile
} from '../../../../refactor/refactor-file-reads'
import { excludeRefactorScratchFromGit } from '../../../../refactor/refactor-git-exclude'
import { refactorJobRegistry } from '../../../../refactor/refactor-job-registry'
import {
  refactorBaselineMap,
  refactorBaselineReader
} from '../../../../refactor/refactor-baselines'
import { assertSafeRefactorTargetPath } from '../../../../refactor/refactor-path-rules'
import { buildRefactorPlan } from '../../../../refactor/refactor-plan-builder'
import { resolveRefactorAgentLaunch } from '../../../../refactor/refactor-agent-launch'
import { runRefactorTurn } from '../../../../refactor/refactor-runner'
import {
  REFACTOR_SOURCE_DIRECTORY_NAME,
  refactorScratchParentRoot,
  refactorScratchRelativeRoot,
  refactorScratchRoot
} from '../../../../refactor/refactor-scratch'
import {
  removeDiscardedRefactorScratch,
  removeExpiredRefactorJobs
} from '../../../../refactor/refactor-scratch-cleanup'
import { claudeStructuredAuthPolicyForSettings } from '../../../../claude-accounts/runtime-auth/claude-structured-auth-policy'
import {
  applyFileChangedMessage,
  applyFileMissingMessage,
  applyNotUtf8Message,
  applyWriteFailedWithReasonMessage,
  methodsJobNotFoundMessage,
  methodsNoPlanMessage,
  methodsRefactorNotFoundMessage,
  methodsRemoteWorkspaceRefusedMessage
} from '../../../../refactor/refactor-messages'
import { resolveStructuredAgentCommand } from '../../../../native-chat/agent-launch/structured-agent-command-resolution'

/** Why the file is refused, in the words the user reads. */
function diskConflictReason(conflict: FileWriteDiskConflict): string {
  if (conflict === 'changed') {
    return applyFileChangedMessage()
  }
  if (conflict === 'missing') {
    return applyFileMissingMessage()
  }
  return applyNotUtf8Message()
}

export const REFACTOR_METHODS = [
  defineMethod({
    name: 'refactor.propose',
    permission: 'workspace',
    params: RefactorProposeParams,
    handler: async (params, { runtime }): Promise<RefactorProposeResult> => {
      // The workspace is resolved here: by the time the background run starts, the handler's
      // context is gone.
      const target = await runtime.resolveRuntimeFileTarget(params.worktree)
      // The agent is a child process on this machine, so a remote workspace's paths belong to
      // another machine: its cwd could not be started and its sources could not be read.
      if (target.executionHostId !== LOCAL_EXECUTION_HOST_ID) {
        throw new Error(methodsRemoteWorkspaceRefusedMessage())
      }
      const workspaceRoot = target.worktree.path
      await assertSafeRefactorTargetPath(workspaceRoot, params.relativePath)

      const jobId = randomUUID()
      const scratchRoot = refactorScratchRoot(workspaceRoot, jobId)
      const scratchRelativeRoot = refactorScratchRelativeRoot(jobId)
      const sourceCopyPath = path.join(
        scratchRoot,
        REFACTOR_SOURCE_DIRECTORY_NAME,
        params.relativePath
      )
      await mkdir(path.dirname(sourceCopyPath), { recursive: true })
      await writeFile(sourceCopyPath, params.content, 'utf8')

      const job = refactorJobRegistry.create({
        jobId,
        scratchRoot,
        worktree: params.worktree,
        // The baseline of the target file is known now: it is the buffer the user is looking at.
        // It is keyed by the file it names, so the manifest can spell the path differently.
        baselines: await refactorBaselineMap({
          workspaceRoot,
          relativePath: params.relativePath,
          content: params.content
        })
      })

      await excludeRefactorScratchFromGit(workspaceRoot)
      await removeExpiredRefactorJobs(refactorScratchParentRoot(workspaceRoot), jobId)

      const runInBackground = async (): Promise<void> => {
        const signal = job.controller.signal
        const settings = runtime.requireStore().getSettings()
        // The account is pushed and Claude refreshed before the agent starts, so the launch
        // uses the account the user picked instead of a stale one.
        await runtime.prepareHostAgentLaunch('claude')
        const launch = await resolveRefactorAgentLaunch({
          cwd: workspaceRoot,
          deps: {
            // The same resolution path as the native chat: a configured Command wins, and the
            // agent name is resolved otherwise.
            resolveCommand: (options) => resolveStructuredAgentCommand('claude', settings, options),
            // Only labels the sign-in failure; it does not pick the executable.
            resolveAuthPolicy: () => claudeStructuredAuthPolicyForSettings(settings),
            // The user's own per-agent environment plus the environment of the current account.
            resolveEnv: () => ({
              ...resolveTuiAgentLaunchEnv('claude', settings),
              ...runtime.getHostAgentLaunchEnv('claude')
            })
          },
          signal
        })
        const turn = await runRefactorTurn({
          launch,
          scratchRoot,
          workspaceRoot,
          prompt: buildRefactorPrompt({
            relativePath: params.relativePath,
            sourceRelativePath: path.join(
              scratchRelativeRoot,
              REFACTOR_SOURCE_DIRECTORY_NAME,
              params.relativePath
            ),
            scratchRelativeRoot,
            instruction: params.instruction
          }),
          onProgress: (text) => {
            refactorJobRegistry.update(jobId, { progress: text })
          },
          signal
        })
        if (signal.aborted) {
          return
        }
        if (turn.state !== 'done') {
          // Without a trustworthy output there is no plan to review.
          refactorJobRegistry.update(jobId, {
            state: turn.state,
            progress: turn.progress,
            warnings: turn.warnings
          })
          return
        }
        const built = await buildRefactorPlan({
          jobId,
          sourcePath: params.relativePath,
          manifest: turn.manifest,
          scratchRoot,
          workspaceRoot,
          // The target file's baseline is the buffer the user saw; every other file's baseline
          // is the disk content of the moment.
          readBaseline: refactorBaselineReader({
            baselines: job.baselines,
            workspaceRoot
          }),
          readDiskContent: async (relativePath) => {
            const read = await readWorkspaceFile(workspaceRoot, relativePath)
            return read.status === 'read' ? read.content : null
          },
          scratchFiles: (proposalId, relativePath) =>
            readScratchFile(scratchRoot, proposalId, relativePath),
          listScratchProposals: () => listScratchProposals(scratchRoot),
          signal
        })
        refactorJobRegistry.update(jobId, {
          state: 'done',
          progress: turn.progress,
          warnings: [...turn.warnings, ...built.warnings],
          plan: built.plan,
          diskContents: built.diskContents
        })
      }

      // A rejected promise nobody holds terminates the main process, so the background run
      // carries its own failure into the job's warnings.
      void runInBackground()
        .catch((error: unknown) => {
          refactorJobRegistry.update(jobId, {
            state: 'failed',
            warnings: [error instanceof Error ? error.message : String(error)]
          })
        })
        .finally(() => removeDiscardedRefactorScratch(jobId, scratchRoot))

      return { jobId }
    }
  }),
  defineMethod({
    name: 'refactor.status',
    permission: 'workspace',
    params: RefactorJobIdParams,
    handler: (params): RefactorStatusResult => {
      const job = refactorJobRegistry.get(params.jobId)
      if (!job) {
        return {
          state: 'failed',
          progress: '',
          warnings: [methodsJobNotFoundMessage()]
        }
      }
      return { state: job.state, progress: job.progress, warnings: job.warnings }
    }
  }),
  defineMethod({
    name: 'refactor.plan',
    permission: 'workspace',
    params: RefactorJobIdParams,
    handler: (params): RefactorPlanResult => {
      const job = refactorJobRegistry.get(params.jobId)
      return { plan: job?.plan ?? null }
    }
  }),
  defineMethod({
    name: 'refactor.apply',
    permission: 'workspace',
    params: RefactorApplyParams,
    handler: async (params, { runtime, signal }): Promise<RefactorApplyResult> => {
      const job = refactorJobRegistry.get(params.jobId)
      // A missing job or plan is a failed call: every refusal names a path, so there is no
      // honest way to report "nothing to write" as a success.
      if (!job) {
        throw new Error(methodsRefactorNotFoundMessage())
      }
      if (!job.plan) {
        throw new Error(methodsNoPlanMessage())
      }
      const target = await runtime.resolveRuntimeFileTarget(job.worktree)
      if (target.executionHostId !== LOCAL_EXECUTION_HOST_ID) {
        throw new Error(methodsRemoteWorkspaceRefusedMessage())
      }
      const workspaceRoot = target.worktree.path
      // The apply stops when the client goes away or the job is discarded: both mean that no
      // new write may start.
      const applySignal =
        signal === undefined
          ? job.controller.signal
          : AbortSignal.any([signal, job.controller.signal])
      const refusalReasons = new Map<string, string>()
      const result = await applyRefactorSelection({
        plan: job.plan,
        diskContents: job.diskContents,
        acceptedHunkIds: params.acceptedHunkIds,
        readCurrent: (relativePath) => readWorkspaceFile(workspaceRoot, relativePath),
        signal: applySignal,
        write: async (relativePath, content, precondition) => {
          try {
            const writeResult = await runtime.writeFileExplorerFile(
              job.worktree,
              relativePath,
              content,
              undefined,
              undefined,
              // The host expectation is not optional: a write without it is refused as a remote
              // change from an outdated client.
              target.executionHostId,
              precondition
            )
            if (writeResult.ok) {
              return true
            }
            refusalReasons.set(relativePath, diskConflictReason(writeResult.diskConflict))
            return false
          } catch (error) {
            // The files already written stay written, so a throwing write is a refusal of this
            // file rather than a failure of the whole apply.
            refusalReasons.set(
              relativePath,
              applyWriteFailedWithReasonMessage(
                error instanceof Error ? error.message : String(error)
              )
            )
            return false
          }
        }
      })
      return {
        applied: result.applied,
        refusals: result.refusals.map((refusal) => ({
          path: refusal.path,
          reason: refusalReasons.get(refusal.path) ?? refusal.reason
        }))
      }
    }
  }),
  defineMethod({
    name: 'refactor.discard',
    permission: 'workspace',
    params: RefactorJobIdParams,
    handler: async (params): Promise<RefactorDiscardResult> => {
      const job = refactorJobRegistry.get(params.jobId)
      if (!job) {
        return { discarded: true }
      }
      // The abort is unconditional: a job whose turn already ended still has a plan, and the
      // apply of that plan is what the abort has to stop. It is harmless once the turn is over.
      job.controller.abort()
      try {
        await rm(job.scratchRoot, { recursive: true, force: true })
      } finally {
        refactorJobRegistry.remove(params.jobId)
      }
      return { discarded: true }
    }
  })
]
