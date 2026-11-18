import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import type { CodeCompletionPlanResult } from '../../../../../shared/rpc-contract/code-completion-params'
import {
  NesEditPlan,
  type NesRequest
} from '../../../../../shared/code-completion/code-completion-types'

const NES_REQUEST_TIMEOUT_MS = 12_000

export async function requestNesPlan(
  input: NesRequest,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<NesEditPlan | null> {
  const timeoutMs = options.timeoutMs ?? NES_REQUEST_TIMEOUT_MS
  try {
    const response = await settleBeforeDeadline(
      callRuntimeRpc<CodeCompletionPlanResult>({ kind: 'local' }, 'codeCompletion.plan', input, {
        signal: options.signal,
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
