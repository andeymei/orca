import { formatNativeChatFileReference } from '../../../../shared/agent-image-paste'
import { replaceImageReferences } from '../../../../shared/native-chat/native-chat-image-reference'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import type { TerminalComposerAttachment } from '@/store/slices/terminal-composer/terminal-composer'
import type { TerminalComposerIntakeHost } from '@/components/terminal-pane/composer/attachments/terminal-composer-attachment-intake'

/**
 * The host that owns the workspace the panel dispatches into.
 *
 * The attachments land on that host, so the agent reads them where it runs: a paired host's file
 * is uploaded to it first.
 */
export function backgroundAgentIntakeHost(args: {
  worktreeId: string | null
  executionHostId: string | null
  /** The workspace's directory, on that host. */
  workspacePath: string | null
}): TerminalComposerIntakeHost | null {
  if (!args.worktreeId || !args.workspacePath) {
    return null
  }
  const host = parseExecutionHostId(args.executionHostId)
  return {
    workspacePath: args.workspacePath,
    worktreeId: args.worktreeId,
    // The background agent's own shell is unknown, so the path is spelled the way its host
    // spells it.
    session: null,
    runtimeEnvironmentId: host?.kind === 'runtime' ? host.environmentId : null,
    connectionId: null
  }
}

/**
 * The prompt as it travels: the text with every attachment named by the path it landed at.
 *
 * A background agent starts with one prompt argument, so an attachment cannot travel as bytes.
 * The mention is the path, and the agent reads the file itself: a probe on 2026-11-22 showed the
 * CLI leaves a mention in the prompt as it is and the agent opens the file with its Read tool.
 */
export function backgroundAgentPrompt(
  text: string,
  attachments: readonly TerminalComposerAttachment[]
): string {
  return replaceImageReferences(text, (attachmentId) => {
    const attachment = attachments.find((candidate) => candidate.id === attachmentId)
    return attachment?.workspacePath ? formatNativeChatFileReference(attachment.workspacePath) : ''
  })
}
