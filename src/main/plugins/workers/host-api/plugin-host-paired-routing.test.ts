import { describe, expect, it } from 'vitest'
import { PLUGIN_WORKSPACE_ACTION_HANDLERS } from './plugin-host-workspace-method-bindings'
import {
  pairedEnvironmentOf,
  pairedRuntimeCall,
  type PluginPairedHosts
} from './plugin-host-paired-hosts'
import type { PluginHostMethodContext } from './plugin-host-method-bind'
import type { PluginHostServices } from './plugin-host-method-bindings'

const REMOTE_WORKTREE_ID = 'wt-remote-1::D:/ctjt/code/ctjt-platform/ctjt-service'

/** The paired server: one worktree, and the calls the plugin made on it. */
function pairedHosts(calls: { method: string; params: unknown }[]): PluginPairedHosts {
  return {
    list: async () => ['env-1'],
    call: async (environmentId, method, params) => {
      calls.push({ method, params: { environmentId, params } })
      if (method === 'worktree.ps') {
        return {
          ok: true,
          result: {
            worktrees: [
              {
                worktreeId: REMOTE_WORKTREE_ID,
                repoId: 'repo-remote-1',
                path: 'D:/ctjt/code/ctjt-platform/ctjt-service',
                branch: 'refs/heads/main',
                displayName: 'ctjt-service',
                repo: 'ctjt-service'
              }
            ]
          }
        }
      }
      return { ok: true, result: { outcome: { kind: 'terminal', handle: 'remote-handle' } } }
    }
  }
}

/** The call context a plugin's worker runs with. */
function context(
  services: Partial<PluginHostServices>,
  runtimeCalls: { method: string; params: unknown }[]
): PluginHostMethodContext {
  return {
    pluginId: 'stablyai.spec-board',
    surface: 'worker',
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the test drives one method, and the host services it does not fill in are never read by it
    services: {
      runtimeRpc: async (method: string, params: unknown) => {
        runtimeCalls.push({ method, params })
        return { outcome: { kind: 'terminal', handle: 'local-handle' } }
      },
      ...services
    } as unknown as PluginHostServices,
    scope: { assertActive: () => {} }
  }
}

describe('a workspace on a paired server runs there', () => {
  it('knows which server holds a workspace', async () => {
    const hosts = pairedHosts([])

    expect(await pairedEnvironmentOf(hosts, REMOTE_WORKTREE_ID)).toBe('env-1')
    expect(await pairedEnvironmentOf(hosts, 'wt-local-1')).toBeNull()
    expect(await pairedEnvironmentOf(null, REMOTE_WORKTREE_ID)).toBeNull()
  })

  it('starts the agent on the server that holds the workspace', async () => {
    const pairedCalls: { method: string; params: unknown }[] = []
    const runtimeCalls: { method: string; params: unknown }[] = []
    const hosts = pairedHosts(pairedCalls)
    const prepared = PLUGIN_WORKSPACE_ACTION_HANDLERS['agent.launch'].prepare({
      workspaceId: REMOTE_WORKTREE_ID,
      agent: 'claude',
      prompt: 'do the work'
    })

    expect(prepared.ok).toBe(true)
    if (!prepared.ok) {
      return
    }
    const result = await prepared.execute(context({ pairedHosts: () => hosts }, runtimeCalls))

    // The launch went to the server: its runtime, not this machine's.
    expect(runtimeCalls).toEqual([])
    const launch = pairedCalls.find((call) => call.method === 'agent.launch')
    expect(launch?.params).toMatchObject({
      environmentId: 'env-1',
      params: {
        agent: 'claude',
        target: { kind: 'existing', worktree: `id:${REMOTE_WORKTREE_ID}` }
      }
    })
    expect(result?.value).toEqual({ terminalId: 'remote-handle' })
  })

  it('hands the prompt to the server in the launch itself', async () => {
    const pairedCalls: { method: string; params: unknown }[] = []
    const runtimeCalls: { method: string; params: unknown }[] = []
    const hosts = pairedHosts(pairedCalls)
    const prepared = PLUGIN_WORKSPACE_ACTION_HANDLERS['agent.launch'].prepare({
      workspaceId: REMOTE_WORKTREE_ID,
      agent: 'claude',
      prompt: 'do the work'
    })

    expect(prepared.ok).toBe(true)
    if (!prepared.ok) {
      return
    }
    await prepared.execute(context({ pairedHosts: () => hosts }, runtimeCalls))

    // One launch, and the prompt is part of it: a pasted prompt needs an agent the server can
    // prove in front of its shell, and a Windows server cannot prove that.
    const launches = pairedCalls.filter((call) => call.method === 'agent.launch')
    expect(launches).toHaveLength(1)
    expect(launches[0]?.params).toMatchObject({
      params: { prompt: { text: 'do the work', delivery: 'submit' } }
    })
  })

  it('starts the agent here when the workspace is this machine’s', async () => {
    const pairedCalls: { method: string; params: unknown }[] = []
    const runtimeCalls: { method: string; params: unknown }[] = []
    const hosts = pairedHosts(pairedCalls)
    const prepared = PLUGIN_WORKSPACE_ACTION_HANDLERS['agent.launch'].prepare({
      workspaceId: 'wt-local-1',
      agent: 'claude'
    })

    expect(prepared.ok).toBe(true)
    if (!prepared.ok) {
      return
    }
    const result = await prepared.execute(context({ pairedHosts: () => hosts }, runtimeCalls))

    expect(runtimeCalls.map((call) => call.method)).toEqual(['agent.launch'])
    expect(pairedCalls.filter((call) => call.method === 'agent.launch')).toEqual([])
    expect(result?.value).toEqual({ terminalId: 'local-handle' })
  })

  it('reports a server that refuses as a refusal, not as a success', async () => {
    const hosts: PluginPairedHosts = {
      list: async () => ['env-1'],
      call: async () => ({ ok: false, error: { message: 'no agent there' } })
    }

    await expect(pairedRuntimeCall(hosts, 'env-1', 'agent.launch', {})).rejects.toThrow(
      /refused the action/
    )
  })
})
