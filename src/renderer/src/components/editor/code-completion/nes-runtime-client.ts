import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import type { CodeCompletionPlanResult } from '../../../../../shared/rpc-contract/code-completion-params'
import {
  NesEditPlan,
  type NesRequest
} from '../../../../../shared/code-completion/code-completion-types'

/**
 * How long the renderer waits for the runtime when no deadline is set. It outlasts the runtime's
 * own window, so the runtime's answer arrives rather than this side's deadline.
 */
const NES_REQUEST_TIMEOUT_MS = 35_000

export async function requestNesPlan(
  input: NesRequest,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<NesEditPlan | null> {
  // Why: a request the caller already gave up on is not a failure, and it never reaches the runtime.
  if (options.signal?.aborted) {
    return null
  }
  // Why zero means the long wait: a deadline of zero is the deadline turned off, and the
  // runtime's own timeout still bounds the request.
  const timeoutMs =
    options.timeoutMs !== undefined && options.timeoutMs > 0
      ? options.timeoutMs
      : NES_REQUEST_TIMEOUT_MS
  // Why a controller of its own: the deadline and the caller's abort both have to reach the
  // runtime, so the request in the main process stops working instead of running on to its end
  // while holding a slot and spending tokens.
  const controller = new AbortController()
  const stop = (): void => {
    controller.abort()
  }
  options.signal?.addEventListener('abort', stop, { once: true })
  const timer = timeoutMs > 0 ? setTimeout(stop, timeoutMs) : null
  try {
    const response = await settleBeforeDeadline(
      callRuntimeRpc<CodeCompletionPlanResult>({ kind: 'local' }, 'codeCompletion.plan', input, {
        signal: controller.signal,
        timeoutMs
      }),
      timeoutMs,
      options.signal
    )
    if (!response) {
      return null
    }
    const parsed = NesEditPlan.safeParse(response.plan)
    return parsed.success ? parsed.data : null
  } catch (error) {
    // Why: a failed request is "no suggestion"; the user has nothing to dismiss.
    console.error('[code-completion] The plan request failed.', { error: errorName(error) })
    return null
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
    options.signal?.removeEventListener('abort', stop)
  }
}

/** The local branch of the transport drops the signal and the timeout, so the renderer keeps its own. */
function settleBeforeDeadline<TResult>(
  call: Promise<TResult>,
  timeoutMs: number,
  signal: AbortSignal | undefined
): Promise<TResult | null> {
  return new Promise<TResult | null>((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), timeoutMs)
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve(null)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    call.then(
      (value) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown'
}
