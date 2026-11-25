import type { RefactorStatusResult } from '../../../../../shared/rpc-contract/refactor-params'

const DEFAULT_POLL_INTERVAL_MS = 1500

/**
 * How many times a status request may fail before the tab gives up.
 *
 * Why it retries: the runtime that holds the job is often a remote host, and a tunnel that drops
 * for a moment says nothing about the job. The old job is still running there either way.
 */
const DEFAULT_MAX_ATTEMPTS = 3

/**
 * Watch a refactoring job until it leaves the running state.
 *
 * Why the fetcher is injected: the poller owns the schedule, the client owns the transport, and a
 * test can drive the schedule without a runtime.
 */
export function pollRefactorJob(input: {
  jobId: string
  intervalMs?: number
  maxAttempts?: number
  fetchStatus: (jobId: string) => Promise<RefactorStatusResult>
  onStatus: (status: RefactorStatusResult) => void
}): () => void {
  const intervalMs = input.intervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let attempts = 0

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
      attempts += 1
      if (attempts < maxAttempts) {
        // Why it waits: the job is on the other side of the tunnel, and a dropped connection is
        // not a failed refactoring.
        timer = setTimeout(() => {
          void poll().catch(logPollFailure)
        }, intervalMs)
        return
      }
      // Why: the job's fate is unknown, so the poll ends as a failure the tab can show.
      stop()
      input.onStatus({ state: 'failed', progress: '', warnings: [failureReason(error)] })
      return
    }
    attempts = 0
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
