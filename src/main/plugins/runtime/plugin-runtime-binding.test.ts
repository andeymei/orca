// The plugin host is bound before the relay is: the paired servers arrive later, and the plugin
// host still has to reach them. The provider is what makes that order work.
import { afterEach, describe, expect, it } from 'vitest'
import type { MobileDesktopRelayHosts } from '../../runtime/mobile-desktop-relay/mobile-desktop-relay-hosts'
import { setPairedRelayHosts } from '../../runtime/paired-relay-hosts'
import { pluginRuntimeDelegate } from './plugin-runtime-binding'

afterEach(() => {
  setPairedRelayHosts(null)
})

/** The runtime side of the delegate, which this test does not use. */
const runtime = {
  resolveActiveWorktreeContext: async () => null,
  listTerminals: async () => ({ terminals: [] }),
  sendTerminal: async () => ({ accepted: true }),
  dispatchPluginNotification: async () => ({ delivered: true }),
  listAgentTasksByPaneKey: () => ({})
}

/** One paired server, as the relay knows it. */
const oneServer: MobileDesktopRelayHosts = {
  list: () => ({
    environments: [{ id: 'env-1', name: 'yolocalc', pairingRevision: 1, runtimeId: 'runtime-1' }],
    statusByEnvironmentId: new Map(),
    sshTargetLabels: new Map(),
    sshConnectionStates: new Map()
  }),
  resolve: async () => null,
  call: async () => ({
    id: 'call-1',
    ok: false,
    error: { code: 'not_found', message: 'no server' }
  }),
  hostsBrowserPage: () => false,
  onEnvironmentRetired: () => () => {},
  onStatusChanged: () => () => {},
  watchChanges: () => ({ close: () => {}, current: () => true })
}

describe('the paired servers the plugin host reaches', () => {
  it('are read when a plugin asks, not when the plugin host is bound', async () => {
    setPairedRelayHosts(null)
    const delegate = pluginRuntimeDelegate(runtime, () => [])
    // The relay is not bound yet: there is nothing to reach.
    expect(delegate.pairedHosts?.()).toBeNull()

    setPairedRelayHosts(oneServer)
    // The servers arrived: the plugin host reaches them from now on.
    await expect(delegate.pairedHosts?.()?.list()).resolves.toEqual(['env-1'])
  })
})
