import { z } from 'zod'
import { PLUGIN_HOST_API } from '../../../../shared/plugins/workers/plugin-host-api'
import { PLUGIN_TERMINAL_READ_MAX_LINES } from '../../../../shared/plugins/workers/plugin-host-api-workspace-methods'
import {
  bind,
  type BoundPluginHostMethod,
  type PluginHostMethodContext
} from './plugin-host-method-bind'
import { PluginHostCallError } from './plugin-host-call-scope'
import { claimPluginReplacedActionRun } from '../../commands/plugin-command-replacement-deadline'
import { parseWorkspaceKey } from '../../../../shared/workspace/identity/workspace-scope'
import {
  pluginHostEffect as effect,
  pluginHostRenderer as renderer,
  pluginHostRpc as rpc,
  pluginWorkspaceSelector as workspaceSelector
} from './plugin-host-runtime-call'
import { listPluginProjects, listPluginWorkspaces } from './plugin-host-workspace-list'
import {
  pairedEnvironmentOf,
  pairedRuntimeCall,
  type PluginPairedHosts
} from './plugin-host-paired-hosts'
import { recordPluginOpenedTerminal } from './plugin-opened-terminals'

const api = PLUGIN_HOST_API
const DEFAULT_READ_LINES = 200

// The parts of each runtime answer a host method reads; anything else is dropped.
const folderUpdateAnswer = z.object({
  folderWorkspace: z.object({ name: z.string() }).nullable()
})
const worktreeSetAnswer = z.object({ worktree: z.object({ displayName: z.string() }) })
const terminalCreateAnswer = z.object({ terminal: z.object({ handle: z.string() }) })
const terminalReadAnswer = z.object({
  terminal: z.object({
    tail: z.array(z.string()),
    truncated: z.boolean().optional(),
    limited: z.boolean().optional()
  })
})
const agentLaunchAnswer = z.object({
  outcome: z.object({ kind: z.enum(['structured', 'terminal']), handle: z.string() })
})

function failureDetail(error: unknown): string {
  if (error instanceof PluginHostCallError) {
    return error.detail ?? error.message
  }
  return error instanceof Error ? error.message : String(error)
}

/**
 * The server that owns a workspace, when it is not this machine.
 *
 * A plugin may name a workspace on a paired server — `workspace.list` promises every host — and
 * the work there belongs to that server: an agent launched for it has to run there, in that
 * server's own workspace. This desktop cannot spawn there, but that server's runtime can, and the
 * desktop reaches it over the paired runtime socket.
 */
async function workspaceOwner(
  ctx: PluginHostMethodContext,
  workspaceId: string
): Promise<{ environmentId: string; pairedHosts: PluginPairedHosts } | null> {
  const pairedHosts = ctx.services.pairedHosts?.() ?? null
  if (!pairedHosts) {
    return null
  }
  const environmentId = await pairedEnvironmentOf(pairedHosts, workspaceId)
  return environmentId === null ? null : { environmentId, pairedHosts }
}

/** A runtime call on the server that owns the workspace; the plugin's approval still gates it. */
async function pairedEffect(
  ctx: PluginHostMethodContext,
  owner: { environmentId: string; pairedHosts: PluginPairedHosts },
  method: string,
  params: unknown
): Promise<unknown> {
  ctx.scope.assertActive()
  return pairedRuntimeCall(owner.pairedHosts, owner.environmentId, method, params)
}

export const PLUGIN_WORKSPACE_ACTION_HANDLERS = {
  'workspace.list': bind(api['workspace.list'], async (params, { services }) =>
    listPluginWorkspaces(
      rpc(services),
      params?.includeStatus === true,
      services.runtimeRpc ?? services,
      services.pairedHosts?.() ?? null
    )
  ),
  'project.list': bind(api['project.list'], async (_params, { services }) =>
    listPluginProjects(rpc(services), services.pairedHosts?.() ?? null)
  ),
  'workspace.open': bind(api['workspace.open'], async ({ workspaceId }, ctx) => {
    const scope = parseWorkspaceKey(workspaceId)
    if (scope?.type === 'folder') {
      // The runtime activates Git worktrees only; Orca's window shows a folder workspace.
      ctx.scope.assertActive()
      await renderer(ctx.services).openFolderWorkspace(scope.folderWorkspaceId)
      return { opened: true as const }
    }
    await effect(ctx, 'worktree.activate', { worktree: workspaceSelector(workspaceId) })
    return { opened: true as const }
  }),
  'workspace.rename': bind(api['workspace.rename'], async ({ workspaceId, name }, ctx) => {
    const trimmed = name.trim()
    const scope = parseWorkspaceKey(workspaceId)
    // The same update as a rename in the sidebar: the name is pinned and a pending
    // automatic (first agent message) rename is cancelled, so neither replaces it later.
    const renamed =
      scope?.type === 'folder'
        ? folderUpdateAnswer.parse(
            await effect(ctx, 'folderWorkspace.update', {
              folderWorkspaceId: scope.folderWorkspaceId,
              // Twins on two hosts can share a folder id; refuse rather than rename both.
              requireUniqueId: true,
              updates: {
                name: trimmed,
                pendingFirstAgentMessageRename: false,
                firstAgentMessageRenameError: null
              }
            })
          ).folderWorkspace?.name
        : worktreeSetAnswer.parse(
            await effect(ctx, 'worktree.set', {
              worktree: workspaceSelector(workspaceId),
              displayName: trimmed
            })
          ).worktree.displayName
    if (renamed === undefined) {
      throw new PluginHostCallError('action_failed', 'no workspace has this id')
    }
    // Orca keeps the old name while the workspace is moving to or from WSL.
    if (renamed !== trimmed) {
      throw new PluginHostCallError('conflict', 'the workspace cannot be renamed right now')
    }
    return { name: trimmed }
  }),
  'terminal.create': bind(api['terminal.create'], async (params, ctx) => {
    const create = {
      worktree: workspaceSelector(params.workspaceId),
      ...(params.title ? { title: params.title } : {}),
      ...(params.command ? { command: params.command } : {}),
      // A mod works beside the person: never reveal or focus the new terminal.
      presentation: 'background'
    }
    // A workspace on a paired server runs there: its terminal belongs to that server.
    const owner = await workspaceOwner(ctx, params.workspaceId)
    const answer =
      owner === null
        ? await effect(ctx, 'terminal.create', create)
        : await pairedEffect(ctx, owner, 'terminal.create', create)
    const terminalId = terminalCreateAnswer.parse(answer).terminal.handle
    // A plugin that lost approval, or a worker that cancelled, while the call ran gains no close
    // rights from it.
    ctx.scope.assertActive()
    if (!ctx.scope.signal?.aborted) {
      recordPluginOpenedTerminal(ctx.pluginId, terminalId)
    }
    return { terminalId }
  }),
  'terminal.read': bind(api['terminal.read'], async (params, { services, scope }) => {
    const limit = Math.min(params.maxLines ?? DEFAULT_READ_LINES, PLUGIN_TERMINAL_READ_MAX_LINES)
    const answer = await rpc(services)(
      'terminal.read',
      { terminal: params.terminalId, limit },
      scope.signal ? { signal: scope.signal } : {}
    )
    const { tail, truncated, limited } = terminalReadAnswer.parse(answer).terminal
    return {
      lines: tail.slice(-limit),
      // `limited`: the runtime itself kept only the newest lines.
      truncated: truncated === true || limited === true || tail.length > limit
    }
  }),
  'agent.launch': bind(api['agent.launch'], async (params, ctx) => {
    const worktree = workspaceSelector(params.workspaceId)
    const launch = {
      target: { kind: 'existing' as const, worktree },
      agent: params.agent,
      // A terminal, so `terminal.read` and `terminal.sendText` reach the agent the call returns.
      surface: 'terminal' as const,
      // A mod works beside the person: never take their focus.
      presentation: 'background' as const,
      launchSource: 'plugin' as const
    }
    // A workspace on a paired server runs there: the agent belongs to that server, in that
    // server's own workspace.
    const owner = await workspaceOwner(ctx, params.workspaceId)
    const answer =
      owner === null
        ? await effect(ctx, 'agent.launch', launch)
        : await pairedEffect(ctx, owner, 'agent.launch', launch)
    const terminalId = agentLaunchAnswer.parse(answer).outcome.handle
    // A plugin that lost approval, or a worker that cancelled, while the call ran gains no close
    // rights from it.
    ctx.scope.assertActive()
    if (!ctx.scope.signal?.aborted) {
      recordPluginOpenedTerminal(ctx.pluginId, terminalId)
    }
    if (params.prompt) {
      // Delivery waits for the agent's composer (up to a minute), longer than a host call may take.
      const deliver = {
        target: { kind: 'existing' as const, worktree },
        agent: params.agent,
        reuseTerminal: { handle: terminalId },
        prompt: { text: params.prompt, delivery: 'submit' as const },
        presentation: 'background' as const,
        launchSource: 'plugin' as const
      }
      void (
        owner === null
          ? effect(ctx, 'agent.launch', deliver)
          : pairedEffect(ctx, owner, 'agent.launch', deliver)
      ).catch((error: unknown) => {
        ctx.scope.log?.(
          `agent.launch: the prompt did not reach ${terminalId}: ${failureDetail(error)}`
        )
      })
    }
    return { terminalId }
  }),
  'editor.open': bind(api['editor.open'], async ({ workspaceId, path }, { services, scope }) => {
    scope.assertActive()
    await renderer(services).openFile(workspaceId, path)
    return { opened: true as const }
  }),
  'commands.run': bind(api['commands.run'], async ({ action }, { pluginId, services, scope }) => {
    scope.assertActive()
    claimPluginReplacedActionRun(pluginId, action)
    // Always Orca's own action, never a plugin command that replaces it: a replacement that
    // calls commands.run for the original would otherwise call itself.
    await renderer(services).runAction(action)
    return { ran: true as const }
  })
} satisfies Record<string, BoundPluginHostMethod>
