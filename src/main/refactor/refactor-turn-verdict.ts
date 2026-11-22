import type { RefactorStatusResult } from '../../shared/rpc-contract/refactor-params'

/** How the turn ended, before the reason it ended is folded into the job state. */
export type RefactorTurnVerdict = {
  state: 'done' | 'failed'
  warnings: string[]
}

/**
 * The fields of the SDK's result frame the verdict reads. The SDK's own `SDKResultMessage` is a
 * union of complete frames, but the transport hands over loose records, so the verdict reads the
 * fields it needs and treats a frame it does not recognise as a failure.
 */
export type RefactorResultFrame = {
  subtype?: unknown
  is_error?: unknown
  stop_reason?: unknown
  result?: unknown
}

function refactorFailureDetail(result: RefactorResultFrame, subtype: string): string {
  if (subtype !== 'success') {
    return subtype.length > 0 ? subtype : 'unknown_error'
  }
  // A success frame with is_error carries the API error text in its result field.
  const text = result.result
  return typeof text === 'string' && text.trim().length > 0 ? text : 'api_error'
}

/**
 * Whether the SDK's result frame means the turn finished or failed. `subtype: 'success'` with
 * `is_error` is a turn that died on an API error, so only a clean success is a done.
 */
export function classifyRefactorResult(result: RefactorResultFrame): RefactorTurnVerdict {
  const subtype = typeof result.subtype === 'string' ? result.subtype : ''
  const stopReason = typeof result.stop_reason === 'string' ? result.stop_reason : ''
  if (subtype === 'success' && result.is_error !== true) {
    return { state: 'done', warnings: [] }
  }
  const stop = stopReason.length > 0 ? `（停止原因：${stopReason}）` : ''
  return {
    state: 'failed',
    warnings: [`这一轮以错误结束：${refactorFailureDetail(result, subtype)}${stop}`]
  }
}

/**
 * Which terminal event ended the turn. A cancellation that arrives after the result frame does
 * not roll back a turn that already finished.
 */
export function refactorTurnCancelledFirst(event: {
  cancelOrder: number
  resultOrder: number
}): boolean {
  if (event.cancelOrder < 0) {
    return false
  }
  return event.resultOrder < 0 || event.cancelOrder < event.resultOrder
}

/**
 * The turn's verdict. A cancellation is the user's own decision and wins; otherwise the result
 * frame is the truth, and only a turn without one is a timeout, a crash, or nothing at all.
 */
export function decideRefactorTurnOutcome(input: {
  result: RefactorTurnVerdict | null
  cancelled: boolean
  timedOut: boolean
  fault: string | null
}): { state: RefactorStatusResult['state']; warnings: string[] } {
  if (input.cancelled) {
    return { state: 'cancelled', warnings: ['任务已取消'] }
  }
  if (input.result) {
    return { state: input.result.state, warnings: [...input.result.warnings] }
  }
  if (input.timedOut) {
    return { state: 'timed_out', warnings: ['任务超时'] }
  }
  if (input.fault) {
    return { state: 'failed', warnings: [`这一轮没有正常结束：${input.fault}`] }
  }
  return { state: 'failed', warnings: ['这一轮没有结束'] }
}
