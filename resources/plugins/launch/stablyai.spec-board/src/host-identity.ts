// The host a project lives on, and whether it can be named safely.
//
// The host id ends up in a command the agent runs on this machine (`ssh -- <target> …`), so a
// host that could be read as an option must never reach it. The ids Orca mints are safe; a
// registry a person edited by hand is not, so the ones that are not are refused rather than
// passed on.

/** The three kinds of host a project can live on. */
const HOST_ID = /^(local|ssh:[A-Za-z0-9._-]+|runtime:[A-Za-z0-9-]+)$/

/**
 * Whether a host id can be named in a command.
 *
 * `local` needs nothing. `ssh:<target>` and `runtime:<id>` name one host: the name may not be
 * empty, may not start with a dash (an option, not a host) and may not carry anything a shell
 * would read as syntax.
 */
export function isSafeHostId(host: string): boolean {
  return HOST_ID.test(host)
}

/** The host of a project, when it can be named; null when it cannot. */
export function safeHostOf(host: string): string | null {
  return isSafeHostId(host) ? host : null
}
