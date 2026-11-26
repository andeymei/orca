// The servers this desktop is paired with.
//
// The relay holds them; whoever has to reach them asks here. The runtime itself has no use for
// them — the plugin host does: it lists the workspaces of every host Orca reaches, and asks the
// paired servers the same way the sidebar does.

import type { MobileDesktopRelayHosts } from './mobile-desktop-relay/mobile-desktop-relay-hosts'

let pairedRelayHosts: MobileDesktopRelayHosts | null = null

/** The servers this desktop is paired with; null where it is paired with none. */
export function setPairedRelayHosts(hosts: MobileDesktopRelayHosts | null): void {
  pairedRelayHosts = hosts
}

/** The servers this desktop is paired with, for whoever has to reach them. */
export function pairedRelayHostsOf(): MobileDesktopRelayHosts | null {
  return pairedRelayHosts
}
