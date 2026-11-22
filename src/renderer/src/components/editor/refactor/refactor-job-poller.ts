import type { RefactorStatusResult } from '../../../../../shared/rpc-contract/refactor-params'

const DEFAULT_POLL_INTERVAL_MS = 1500

/**
 * Watch a refactoring job until it leaves the running state.
 *
 * Why the fetcher is injected: the poller owns the schedule, the client owns the transport, and a
 * test can drive the schedule without a runtime.
 */
export function pollRefactorJob(input: {
  jobId: string
  intervalMs?: number
  fetchStatus: (jobId: string) => Promise<RefactorStatusResult>
  onStatus: (status: RefactorStatusResult) => void
}): () => void {
  const intervalMs = input.intervalMs ?? DEFAULT_POLL_INTERVAL_MS
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const stop = (): void => {
    stopped = true
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  const poll = async (): Promise<void> => {
    if (stopped) {
      return
    }
    let status: RefactorStatusResult
    try {
      status = await input.fetchStatus(input.jobId)
    } catch (error) {
      // Why: the job's fate is unknown, so the poll ends as a failure the tab can show.
      stop()
      input.onStatus({ state: 'failed', progress: '', warnings: [failureReason(error)] })
      return
    }
    if (stopped) {
      return
    }
    input.onStatus(status)
    if (status.state !== 'running') {
      stop()
      return
    }
    timer = setTimeout(() => {
      void poll().catch(logPollFailure)
    }, intervalMs)
  }

  void poll().catch(logPollFailure)

  return stop
}

function failureReason(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return 'The refactoring status request failed.'
}

/** Why logged and not thrown: a broken callback must not leave an unhandled rejection behind. */
function logPollFailure(error: unknown): void {
  console.error('[refactor] The refactoring job poll failed.', {
    error: error instanceof Error ? error.name : 'unknown'
  })
}
