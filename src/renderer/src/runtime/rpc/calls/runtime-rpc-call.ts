import { waitForPromiseWithSignal } from '../../../../../shared/abort-signal-reason'
import { createNonSecureContextUuid } from '../../../../../shared/non-secure-context-uuid'
import type { RuntimeRpcResponse } from '../../../../../shared/runtime-rpc-envelope'
import type { RuntimeStatus } from '../../../../../shared/runtime-session-contracts'
import { withBrowserPaneUiRuntimeRpcSource } from '../../../../../shared/runtime-rpc-feature-interaction-source'
import { createRuntimeRpcAbortError } from './abortable-runtime-environment-call'
import { callRuntimeEnvironmentWithRevision } from './runtime-rpc-environment-call'
import { unwrapRuntimeRpcResult } from './runtime-rpc-result'
import { captureRuntimeEnvironmentRequestRevision } from '../environment-revisions/runtime-environment-revision'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import { ensureRuntimeEnvironmentCompatible } from '../compatibility/runtime-compatibility-probe'

export async function callRuntimeRpc<TResult>(
  target: RuntimeClientTarget,
  method: string,
  params?: unknown,
  options: {
    timeoutMs?: number
    suppressFeatureInteraction?: boolean
    reuseRecentCompatibilityFailure?: boolean
    skipCompatibilityCheck?: boolean
    signal?: AbortSignal
    expectedEnvironmentPairingRevision?: number
    expectedEnvironmentRuntimeId?: string
    beforeSend?: () => void
    paramsForStatus?: (status: RuntimeStatus | null) => unknown
  } = {}
): Promise<TResult> {
  if (options.signal?.aborted) {
    throw createRuntimeRpcAbortError()
  }
  const expectedEnvironmentPairingRevision =
    target.kind === 'environment'
      ? captureRuntimeEnvironmentRequestRevision(
          target.environmentId,
          options.expectedEnvironmentPairingRevision
        )
      : undefined
  const compatibilityStatus =
    target.kind === 'environment' &&
    method !== 'status.get' &&
    options.skipCompatibilityCheck !== true
      ? await waitForPromiseWithSignal(
          ensureRuntimeEnvironmentCompatible(target.environmentId, {
            ...options,
            expectedEnvironmentPairingRevision
          }),
          options.signal
        )
      : null
  if (options.signal?.aborted) {
    throw createRuntimeRpcAbortError()
  }
  const selectedParams = options.paramsForStatus
    ? options.paramsForStatus(compatibilityStatus)
    : params
  const nextParams = options.suppressFeatureInteraction
    ? withBrowserPaneUiRuntimeRpcSource(selectedParams)
    : selectedParams
  options.beforeSend?.()
  const response =
    target.kind === 'local'
      ? await callLocalRuntime(method, nextParams, options.signal)
      : await callRuntimeEnvironmentWithRevision({
          environmentId: target.environmentId,
          method,
          params: nextParams,
          timeoutMs: options.timeoutMs,
          signal: options.signal,
          expectedEnvironmentPairingRevision,
          expectedEnvironmentRuntimeId:
            options.expectedEnvironmentRuntimeId ??
            (options.paramsForStatus ? compatibilityStatus?.runtimeId : undefined)
        })
  return unwrapRuntimeRpcResult<TResult>(response as RuntimeRpcResponse<TResult>)
}

/**
 * A call to the runtime in this process, and the way to stop it.
 *
 * Why the call is named: an invoke cannot be cancelled, so the main process is told to stop the
 * call by its name. A request the renderer no longer waits for must not hold a slot or spend
 * tokens on an answer nobody will read.
 */
async function callLocalRuntime(
  method: string,
  params: unknown,
  signal: AbortSignal | undefined
): Promise<RuntimeRpcResponse<unknown>> {
  if (!signal) {
    return window.api.runtime.call({ method, params })
  }
  const requestId = `renderer-${createNonSecureContextUuid()}`
  const cancel = (): void => {
    window.api.runtime.cancelCall({ requestId })
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    return await window.api.runtime.call({ method, params, requestId })
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}
