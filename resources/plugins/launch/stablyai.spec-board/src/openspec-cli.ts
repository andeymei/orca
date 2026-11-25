// Whether the OpenSpec CLI is on this machine, and which version it is. The board asks the CLI
// nothing else: a command it cannot run is offered to an agent instead.
//
// The binary is run without a shell, so nothing in its arguments can be read as a command, and
// the run is cut off after three seconds: a CLI that hangs must not hang the board.
//
// The probe has three answers: the CLI is there, the CLI is not there, and the probe could not
// tell. The third one is the only honest answer on Windows, where the command is a `.cmd` that
// node cannot run without a terminal: a plugin must not claim a CLI is missing where there might
// be one.

import { execFile } from 'node:child_process'

/** How long the version probe may take. */
const PROBE_TIMEOUT_MS = 3000

/** What the probe found: the CLI is there, and which version it is. */
export type CliProbe = { available: boolean; version?: string }

/**
 * The binary the probe runs, or null when it cannot run one. On Windows the command is a `.cmd`,
 * which node cannot execute on its own: it needs a terminal, and the probe has none.
 */
export function cliBinaryFor(platform: NodeJS.Platform): string | null {
  return platform === 'win32' ? null : 'openspec'
}

/**
 * The version of the CLI, or the fact that there is none — or that the probe could not tell.
 * A missing binary, a CLI that fails and a CLI that hangs all read the same way here: there is
 * no CLI on this side, so the board offers the agent form of every command.
 */
export function probeOpenspecCli(
  platform: NodeJS.Platform = process.platform
): Promise<CliProbe | null> {
  const binary = cliBinaryFor(platform)
  if (binary === null) {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    try {
      execFile(
        binary,
        ['--version'],
        { timeout: PROBE_TIMEOUT_MS, windowsHide: true },
        (error, stdout) => {
          if (error) {
            resolve({ available: false })
            return
          }
          const version = stdout.trim()
          resolve(version === '' ? { available: true } : { available: true, version })
        }
      )
    } catch {
      resolve({ available: false })
    }
  })
}

/**
 * How the worker asks about the CLI. The probe runs the real binary, so the answer is a fact
 * about this machine; a test replaces `read` to answer for a machine it cannot change, which
 * keeps the tests from depending on whether the machine running them has the CLI installed.
 */
export const cliProbe: { read: () => Promise<CliProbe | null> } = { read: probeOpenspecCli }
