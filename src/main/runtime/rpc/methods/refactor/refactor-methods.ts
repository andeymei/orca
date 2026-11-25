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
import type { FileWriteDiskConflict } from '../../../../../shared/file-write/file-write-disk-precondition'
import { applyRefactorSelection } from '../../../../refactor/refactor-apply'
import { readWorkspaceFile } from '../../../../refactor/refactor-file-reads'
import { excludeRefactorScratchFromGit } from '../../../../refactor/refactor-git-exclude'
import { refactorJobRegistry } from '../../../../refactor/refactor-job-registry'
import { refactorBaselineMap } from '../../../../refactor/refactor-baselines'
import { assertSafeRefactorTargetPath } from '../../../../refactor/refactor-path-rules'
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
import {
  applyFileChangedMessage,
  applyFileMissingMessage,
  applyNotUtf8Message,
  applyWriteFailedWithReasonMessage,
  methodsJobAlreadyRunningMessage,
  methodsJobNotFoundMessage,
  methodsNoPlanMessage,
  methodsRefactorNotFoundMessage,
  methodsRemoteWorkspaceRefusedMessage
} from '../../../../refactor/refactor-messages'
import { runRefactorProposalTurn } from './refactor-proposal-turn'

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

      // Why it refuses: two turns on one file compete for the same agent and the same budget, and
      // the user pays for two reviews of one change.
      if (refactorJobRegistry.findRunning(params.worktree, params.relativePath) !== null) {
        throw new Error(methodsJobAlreadyRunningMessage())
      }

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
        relativePath: params.relativePath,
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

      // A rejected promise nobody holds terminates the main process, so the background run
      // carries its own failure into the job's warnings.
      void runRefactorProposalTurn({
        runtime,
        job,
        scratchRelativeRoot,
        workspaceRoot,
        relativePath: params.relativePath,
        instruction: params.instruction
      })
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
