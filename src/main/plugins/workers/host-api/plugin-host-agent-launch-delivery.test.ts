import { describe, expect, it, vi } from 'vitest'
import { PLUGIN_WORKSPACE_ACTION_HANDLERS } from './plugin-host-workspace-method-bindings'
import type { PluginHostMethodContext } from './plugin-host-method-bind'
import type { PluginHostServices } from './plugin-host-method-bindings'

/** The calls the plugin's worker made on this machine. */
function localContext(
  runtimeCalls: { method: string; params: unknown }[]
): PluginHostMethodContext {
  return {
    pluginId: 'stablyai.spec-board',
    surface: 'worker',
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the test drives one method, and the host services it does not fill in are never read by it
    services: {
      runtimeRpc: async (method: string, params: unknown) => {
        runtimeCalls.push({ method, params })
        return {
          outcome: { kind: 'terminal', handle: 'local-handle' },
          prompt: { delivery: 'submit', outcome: 'handed-to-terminal' }
        }
      }
    } as unknown as PluginHostServices,
    scope: { assertActive: () => {} }
  }
}

describe('the prompt of a launch', () => {
  it('rides the launch when the agent takes it on its launch command', async () => {
    const runtimeCalls: { method: string; params: unknown }[] = []
    const prepared = PLUGIN_WORKSPACE_ACTION_HANDLERS['agent.launch'].prepare({
      workspaceId: 'wt-local-1',
      agent: 'claude',
      prompt: 'do the work'
    })

    expect(prepared.ok).toBe(true)
    if (!prepared.ok) {
      return
    }
    await prepared.execute(localContext(runtimeCalls))

    // One call, and the prompt is in it: a Windows host cannot prove an agent in front of its
    // shell, so a prompt pasted into a running agent would never arrive there.
    expect(runtimeCalls).toHaveLength(1)
    expect(runtimeCalls[0]?.params).toMatchObject({
      prompt: { text: 'do the work', delivery: 'submit' }
    })
  })

  it('goes to the running agent when the agent takes its prompt only after it starts', async () => {
    const runtimeCalls: { method: string; params: unknown }[] = []
    const prepared = PLUGIN_WORKSPACE_ACTION_HANDLERS['agent.launch'].prepare({
      workspaceId: 'wt-local-1',
      agent: 'ante',
      prompt: 'do the work'
    })

    expect(prepared.ok).toBe(true)
    if (!prepared.ok) {
      return
    }
    await prepared.execute(localContext(runtimeCalls))

    // Such an agent refuses a prompt on its launch command, so the launch carries none and the
    // prompt follows into the agent that is already running.
    expect(runtimeCalls[0]?.params).not.toHaveProperty('prompt')
    await vi.waitFor(() => {
      expect(runtimeCalls).toHaveLength(2)
    })
    expect(runtimeCalls[1]?.params).toMatchObject({
      reuseTerminal: { handle: 'local-handle' },
      prompt: { text: 'do the work', delivery: 'submit' }
    })
  })
})
