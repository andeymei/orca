import type { NativeChatComposerProps } from './native-chat-composer-types'

/**
 * The identity of the composer a paste belongs to.
 *
 * A paste's pending work is retired when this changes, so the key names the pane, its
 * terminal and the structured chat behind it.
 */
export function nativeChatComposerTargetKey(
  paneKey: string,
  targetPtyId: string | null,
  structuredTransport: NativeChatComposerProps['structuredTransport']
): string {
  return JSON.stringify([
    paneKey,
    targetPtyId,
    structuredTransport?.sessionId,
    structuredTransport?.worktreeId,
    structuredTransport?.runtimeEnvironmentId
  ])
}
