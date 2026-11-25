// Whether the OpenSpec CLI is on this machine, and which version it is. The board asks the CLI
// nothing else: a command it cannot run is offered to an agent instead.
//
// The binary is run without a shell, so nothing in its arguments can be read as a command, and
// the run is cut off after three seconds: a CLI that hangs must not hang the board.

import { execFile } from 'node:child_process'

/** How long the version probe may take. */
const PROBE_TIMEOUT_MS = 3000

/** The binary's name. On Windows the command is a `.cmd`, which cannot be run without a shell. */
const BINARY = process.platform === 'win32' ? 'openspec.cmd' : 'openspec'

/** What the probe found: the CLI is there, and which version it is. */
export type CliProbe = { available: boolean; version?: string }

/**
 * The version of the CLI, or the fact that there is none. A missing binary, a CLI that fails and
 * a CLI that hangs all read the same way: there is no CLI here, so the board offers the agent
 * form of every command.
 */
export function probeOpenspecCli(): Promise<CliProbe> {
  return new Promise((resolve) => {
    try {
      execFile(
        BINARY,
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
export const cliProbe: { read: () => Promise<CliProbe> } = { read: probeOpenspecCli }
