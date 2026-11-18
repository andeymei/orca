import { parseExecutionHostId } from '../../../../../../shared/execution-host'
import { captureDirectSshMutationExpectation } from '@/runtime/hosts/ssh/ssh-mutation-expectation'
import { useAppStore } from '@/store/index'
import type { PtyTransport } from '../../pty-transport/pty-transport-types'

/** The fence's own error: the host moved under the upload. */
export const TERMINAL_DROP_HOST_CHANGED_MESSAGE = 'Terminal upload host changed; retry the drop.'

export function captureTerminalDropTransportOwner(
  transport: Pick<PtyTransport, 'getExecutionHostId' | 'getRuntimeEnvironmentId'>
) {
  const host = parseExecutionHostId(transport.getExecutionHostId?.())
  if (!host) {
    return null
  }
  const runtimeEnvironmentId =
    transport.getRuntimeEnvironmentId?.() ?? (host.kind === 'runtime' ? host.environmentId : null)
  const connectionId = host.kind === 'ssh' ? host.targetId : null
  const captureExpectation = () =>
    connectionId
      ? captureDirectSshMutationExpectation(
          useAppStore.getState(),
          connectionId,
          runtimeEnvironmentId
        )
      : { expectedExecutionHostId: 'local' as const }
  const expectation = captureExpectation()
  const assertCurrent = (): void => {
    const current = captureExpectation()
    if (
      transport.getExecutionHostId?.() !== host.id ||
      (transport.getRuntimeEnvironmentId?.() ??
        (host.kind === 'runtime' ? host.environmentId : null)) !== runtimeEnvironmentId ||
      current.expectedExecutionHostId !== expectation.expectedExecutionHostId ||
      ('expectedSshConnectionGeneration' in current &&
        'expectedSshConnectionGeneration' in expectation &&
        current.expectedSshConnectionGeneration !== expectation.expectedSshConnectionGeneration)
    ) {
      throw new Error(TERMINAL_DROP_HOST_CHANGED_MESSAGE)
    }
  }
  return {
    executionHostId: host.id,
    runtimeEnvironmentId,
    connectionId,
    assertCurrent,
    ...expectation
  }
}
