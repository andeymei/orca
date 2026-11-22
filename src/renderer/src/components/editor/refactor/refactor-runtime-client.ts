import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { toRuntimeWorktreeSelector } from '@/runtime/rpc/targets/runtime-worktree-selector'
import {
  RefactorApplyResult,
  RefactorDiscardResult,
  RefactorPlanResult,
  RefactorProposeResult,
  RefactorStatusResult
} from '../../../../../shared/rpc-contract/refactor-params'
import type { RefactorPlan } from '../../../../../shared/refactor/refactor-types'

const REFACTOR_PROPOSE_TIMEOUT_MS = 35_000
const REFACTOR_STATUS_TIMEOUT_MS = 35_000
const REFACTOR_PLAN_TIMEOUT_MS = 35_000
/** Why longer: a write reaches the disk, and a slow disk is not a failed write. */
const REFACTOR_APPLY_TIMEOUT_MS = 60_000
const REFACTOR_DISCARD_TIMEOUT_MS = 35_000

const REFACTOR_TIMEOUT_MESSAGE = 'The refactoring request timed out.'

/**
 * Start a refactoring job and answer its id.
 *
 * Why null instead of a throw: the caller opens a tab and a toast, and a failed start has no tab
 * to show an error in.
 */
export async function proposeRefactor(input: {
  worktreeId: string
  relativePath: string
  content: string
  instruction?: string
}): Promise<string | null> {
  try {
    const response = await callRefactorRpc<RefactorProposeResult>(
      'refactor.propose',
      {
        // Why a selector: the runtime addresses a workspace by its selector, not by the renderer's
        // own workspace id.
        worktree: toRuntimeWorktreeSelector(input.worktreeId),
        relativePath: input.relativePath,
        content: input.content,
        ...(input.instruction === undefined ? {} : { instruction: input.instruction })
      },
      REFACTOR_PROPOSE_TIMEOUT_MS
    )
    const parsed = RefactorProposeResult.safeParse(response)
    if (!parsed.success) {
      console.error('[refactor] The propose result does not parse.')
      return null
    }
    return parsed.data.jobId
  } catch (error) {
    console.error('[refactor] The propose request failed.', { error: errorName(error) })
    return null
  }
}

/**
 * Read how far a refactoring job has come.
 *
 * Why a failure throws: the poller turns it into a failed state, and a status that reads as
 * "still running" would leave the review tab waiting for an answer that is never coming.
 */
export async function fetchRefactorStatus(jobId: string): Promise<RefactorStatusResult> {
  let response: RefactorStatusResult
  try {
    response = await callRefactorRpc<RefactorStatusResult>(
      'refactor.status',
      { jobId },
      REFACTOR_STATUS_TIMEOUT_MS
    )
  } catch (error) {
    console.error('[refactor] The status request failed.', { error: errorName(error) })
    throw error
  }
  const parsed = RefactorStatusResult.safeParse(response)
  if (!parsed.success) {
    console.error('[refactor] The status result does not parse.')
    throw new Error('The refactoring status could not be read.')
  }
  return parsed.data
}

/** The plan of a finished job; null when the runtime has no plan for it yet. */
export async function fetchRefactorPlan(jobId: string): Promise<RefactorPlan | null> {
  try {
    const response = await callRefactorRpc<RefactorPlanResult>(
      'refactor.plan',
      { jobId },
      REFACTOR_PLAN_TIMEOUT_MS
    )
    const parsed = RefactorPlanResult.safeParse(response)
    if (!parsed.success) {
      console.error('[refactor] The plan result does not parse.')
      return null
    }
    return parsed.data.plan
  } catch (error) {
    console.error('[refactor] The plan request failed.', { error: errorName(error) })
    return null
  }
}

/**
 * Write the accepted hunks to the workspace.
 *
 * Why a failure throws: the user pressed accept, and a write that silently did not happen is the
 * worst outcome, so the caller has to be able to say so.
 */
export async function applyRefactor(
  jobId: string,
  acceptedHunkIds: readonly string[]
): Promise<RefactorApplyResult> {
  let response: RefactorApplyResult
  try {
    response = await callRefactorRpc<RefactorApplyResult>(
      'refactor.apply',
      { jobId, acceptedHunkIds: [...acceptedHunkIds] },
      REFACTOR_APPLY_TIMEOUT_MS
    )
  } catch (error) {
    console.error('[refactor] The apply request failed.', { error: errorName(error) })
    throw error
  }
  const parsed = RefactorApplyResult.safeParse(response)
  if (!parsed.success) {
    console.error('[refactor] The apply result does not parse.')
    throw new Error('The refactoring result could not be read.')
  }
  return parsed.data
}

/** Drop a job and its scratch files; false when the runtime kept it. */
export async function discardRefactor(jobId: string): Promise<boolean> {
  try {
    const response = await callRefactorRpc<RefactorDiscardResult>(
      'refactor.discard',
      { jobId },
      REFACTOR_DISCARD_TIMEOUT_MS
    )
    const parsed = RefactorDiscardResult.safeParse(response)
    if (!parsed.success) {
      console.error('[refactor] The discard result does not parse.')
      return false
    }
    return parsed.data.discarded
  } catch (error) {
    console.error('[refactor] The discard request failed.', { error: errorName(error) })
    return false
  }
}

/**
 * Call the local runtime under a deadline the renderer keeps.
 *
 * Why the controller: the local branch of the transport drops the timeout, so the renderer aborts
 * the call itself and a request nobody waits for stops working in the runtime.
 */
async function callRefactorRpc<TResult>(
  method: string,
  params: unknown,
  timeoutMs: number
): Promise<TResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let answered = false
  try {
    const response = await settleBeforeDeadline(
      callRuntimeRpc<TResult>({ kind: 'local' }, method, params, {
        signal: controller.signal,
        timeoutMs
      }),
      timeoutMs
    )
    answered = true
    return response
  } finally {
    clearTimeout(timer)
    // Why: a call that never answered must not keep working in the runtime after the deadline.
    if (!answered) {
      controller.abort()
    }
  }
}

/** The local branch of the transport drops the signal and the timeout, so the renderer keeps its own. */
function settleBeforeDeadline<TResult>(
  call: Promise<TResult>,
  timeoutMs: number
): Promise<TResult> {
  return new Promise<TResult>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(REFACTOR_TIMEOUT_MESSAGE)), timeoutMs)
    call.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown'
}
