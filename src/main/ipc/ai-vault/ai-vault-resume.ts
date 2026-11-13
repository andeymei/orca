import { AiVaultPrepareSessionResumeParams } from '../../../shared/rpc-contract/ai-vault-params'
import { prepareStructuredChatCliFork } from '../../ai-vault/structured-chat-cli-fork'
import { ipcMain } from 'electron'
import type {
  AiVaultPrepareSessionResumeRequest,
  AiVaultPrepareSessionResumeResult,
  AiVaultSessionResumePreparation
} from '../../../shared/ai-vault/resume/ai-vault-resume-preparation'
import { isUnresolvedOwnerHostId, parseExecutionHostId } from '../../../shared/execution-host'
import { isWslUncPath } from '../../../shared/wsl-paths'
import { assertLegacyAiVaultResumeAllowed } from '../../ai-vault/structured-session-ownership'
import { tryEnsureStructuredAgentSessionHostForResume } from '../../runtime/agent-session/structured-agent-session-host-refusal'
import { copyStructuredChatConversation } from '../../ai-vault/structured-chat-conversation-copy'
import { wakeNativeChatTranscriptDistro } from '../../native-chat/native-chat-open-wake'
import { wslDistroForPath } from '../../wsl/filesystem/wsl-unc-access-gate'
import type {
  ClaudeBackgroundAgent,
  ClaudeBackgroundAgentRequest
} from '../../../shared/claude-background-agents'
import { listClaudeBackgroundAgents } from '../../claude/background-agents/claude-background-agent-list'
import { listRuntimeClaudeBackgroundAgents } from '../../ai-vault/runtime-claude-background-agents'
import { listRunningAgentsForHost } from './ai-vault-running-agents'
import { getRuntimeEnvironmentRegistryRoot } from '../runtime-environments/runtime-environment-registry-root'

export type AiVaultResumeHandlerOptions = {
  ensureStructuredSessionOwnership?: () => Promise<void>
  prepareSessionResume?: AiVaultSessionResumePreparation
  prepareRuntimeSessionResume?: (
    environmentId: string,
    args: AiVaultPrepareSessionResumeRequest
  ) => Promise<AiVaultPrepareSessionResumeResult>
  /** The agents a paired runtime host runs; a host's own listing cannot answer for another host. */
  listRuntimeRunningAgents?: (environmentId: string) => Promise<ClaudeBackgroundAgent[] | null>
}

export function registerAiVaultResumeHandler(options: AiVaultResumeHandlerOptions): void {
  ipcMain.handle(
    'aiVault:prepareSessionResume',
    (_event, args: AiVaultPrepareSessionResumeRequest) => prepareAiVaultSessionResume(args, options)
  )
  // The picker needs to know which conversations already run: a running one is opened where it
  // runs, because resuming it makes the CLI copy the conversation into a second session.
  ipcMain.handle(
    'aiVault:listRunningAgents',
    async (
      _event,
      args?: ClaudeBackgroundAgentRequest
    ): Promise<ClaudeBackgroundAgent[] | null> => {
      try {
        return await listRunningAgentsForHost(args?.executionHostId, {
          listLocalAgents: () => listClaudeBackgroundAgents(),
          listRuntimeAgents: options.listRuntimeRunningAgents ?? listRuntimeRunningAgentsOfHost
        })
      } catch (error) {
        console.error('[ai-vault] listing running Claude agents failed:', error)
        // The host could not report; the caller asks it itself instead of resuming blindly.
        return null
      }
    }
  )
}

/** The agents a paired runtime host runs; the host answers with its own CLI. */
async function listRuntimeRunningAgentsOfHost(
  environmentId: string
): Promise<ClaudeBackgroundAgent[] | null> {
  return listRuntimeClaudeBackgroundAgents(getRuntimeEnvironmentRegistryRoot(), environmentId)
}

export async function prepareAiVaultSessionResume(
  args: AiVaultPrepareSessionResumeRequest,
  options: AiVaultResumeHandlerOptions
): Promise<AiVaultPrepareSessionResumeResult> {
  const executionHost = parseExecutionHostId(args.executionHostId)
  if (executionHost?.kind === 'runtime') {
    if (!options.prepareRuntimeSessionResume || isUnresolvedOwnerHostId(executionHost.id)) {
      throw new Error('The session host is unavailable. Reconnect it and retry resume.')
    }
    return options.prepareRuntimeSessionResume(executionHost.environmentId, args)
  }
  if ('sourceChat' in args) {
    const parsed = AiVaultPrepareSessionResumeParams.parse(args)
    if (!('sourceChat' in parsed)) {
      throw new Error('Invalid chat source.')
    }
    if (executionHost?.kind === 'ssh') {
      throw new Error('This chat cannot be copied on this host.')
    }
    await options.ensureStructuredSessionOwnership?.()
    return prepareStructuredChatCliFork(
      parsed,
      options.prepareSessionResume ?? (async () => ({ useRealCodexHome: false }))
    )
  }
  // Why: the desktop process must never materialize transcript paths owned by an SSH host.
  if (executionHost?.kind === 'ssh') {
    return { useRealCodexHome: false }
  }
  // Resuming a session is a user act: start its stopped distro before the gated transcript reads.
  await wakeNativeChatTranscriptDistro(wslDistroForPath(args.filePath))
  if (!isWslUncPath(args.filePath)) {
    if (options.ensureStructuredSessionOwnership) {
      await (args.codexHome === null && !args.fork
        ? tryEnsureStructuredAgentSessionHostForResume(options.ensureStructuredSessionOwnership)
        : options.ensureStructuredSessionOwnership())
    }
    assertLegacyAiVaultResumeAllowed(args)
  }
  return (
    (await copyStructuredChatConversation(args)) ??
    options.prepareSessionResume?.(args) ?? { useRealCodexHome: false }
  )
}
