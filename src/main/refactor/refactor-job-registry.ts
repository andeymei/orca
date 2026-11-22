import type { RefactorPlan } from '../../shared/refactor/refactor-types'
import type { RefactorStatusResult } from '../../shared/rpc-contract/refactor-params'
import type { RefactorBaseline } from './refactor-baselines'

export type RefactorJob = {
  jobId: string
  state: RefactorStatusResult['state']
  progress: string
  warnings: string[]
  plan: RefactorPlan | null
  /** The disk content of each file at the moment the plan was built, for the staleness check. */
  diskContents: Map<string, string>
  /**
   * The target file's baseline (the editor buffer and the witness of the file's identity),
   * under every key the file answers to: its canonical path, the path it was named by, and
   * its inode.
   */
  baselines: Map<string, RefactorBaseline>
  /** The original worktree selector, replayed when the accepted changes are written back. */
  worktree: string
  controller: AbortController
  scratchRoot: string
}

export type RefactorJobCreateInput = {
  jobId: string
  scratchRoot: string
  worktree: string
  /** Known when the job starts, so it arrives with the job rather than being patched in later. */
  baselines?: Map<string, RefactorBaseline>
}

export type RefactorJobUpdate = Partial<
  Pick<RefactorJob, 'state' | 'progress' | 'warnings' | 'plan' | 'diskContents' | 'baselines'>
>

export type RefactorJobRegistry = {
  create(input: RefactorJobCreateInput): RefactorJob
  get(jobId: string): RefactorJob | null
  update(jobId: string, patch: RefactorJobUpdate): void
  remove(jobId: string): void
}

export function createRefactorJobRegistry(): RefactorJobRegistry {
  const jobs = new Map<string, RefactorJob>()

  return {
    create(input): RefactorJob {
      const job: RefactorJob = {
        jobId: input.jobId,
        state: 'running',
        progress: '',
        warnings: [],
        plan: null,
        diskContents: new Map(),
        baselines: input.baselines ?? new Map(),
        worktree: input.worktree,
        controller: new AbortController(),
        scratchRoot: input.scratchRoot
      }
      jobs.set(job.jobId, job)
      return job
    },

    get(jobId: string): RefactorJob | null {
      return jobs.get(jobId) ?? null
    },

    update(jobId: string, patch: RefactorJobUpdate): void {
      const job = jobs.get(jobId)
      // The background run can finish after the user discarded the job, and a throw there
      // surfaces as an unhandled rejection in the main process.
      if (!job) {
        return
      }
      if (patch.state !== undefined) {
        job.state = patch.state
      }
      if (patch.progress !== undefined) {
        job.progress = patch.progress
      }
      // The warnings replace the previous list: the caller owns the whole set.
      if (patch.warnings !== undefined) {
        job.warnings = patch.warnings
      }
      if (patch.plan !== undefined) {
        job.plan = patch.plan
      }
      if (patch.diskContents !== undefined) {
        job.diskContents = patch.diskContents
      }
      if (patch.baselines !== undefined) {
        job.baselines = patch.baselines
      }
    },

    remove(jobId: string): void {
      jobs.delete(jobId)
    }
  }
}

/** The RPC methods share one registry: a job created by one method is read by the others. */
export const refactorJobRegistry = createRefactorJobRegistry()
