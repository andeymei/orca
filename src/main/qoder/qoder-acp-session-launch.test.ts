import { writeFile } from 'node:fs/promises'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { expect, it } from 'vitest'
import { spawnProcess } from '@orca/process-host'
import { ACP_PROTOCOL_VERSION } from '../acp/generated/acp-protocol.generated'
import { QODER_ACP_LAUNCH_SPECS } from './qoder-acp-launch-spec'

type QoderAcpSpec = (typeof QODER_ACP_LAUNCH_SPECS)[number]
type AcpFrame = {
  id?: number
  method?: string
  result?: Record<string, unknown>
  error?: { code?: number; message?: string }
}

const HANDSHAKE_TIMEOUT_MS = 60_000
const EXIT_TIMEOUT_MS = 10_000
const KILL_TIMEOUT_MS = 5_000

/** The CLI inherits the developer's own home so the handshake proves the signed-in account. */
function launchEnvironment(spec: QoderAcpSpec): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value
    }
  }
  for (const key of spec.scrubEnvironment?.(env, process.env) ?? []) {
    delete env[key]
  }
  Object.assign(env, spec.env)
  return env
}

/** ACP frames are line-delimited JSON; notifications can arrive before a response. */
function readAcpFrames(child: ChildProcessWithoutNullStreams): {
  take: (id: number, timeoutMs: number) => Promise<AcpFrame>
} {
  const frames: AcpFrame[] = []
  let pending: {
    id: number
    resolve: (frame: AcpFrame) => void
    reject: (error: Error) => void
  } | null = null
  let buffer = ''
  let stderr = ''
  let failure: Error | null = null
  // A missing binary fails the spawn; the streams would error out unhandled.
  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    stream.on('error', () => {})
  }
  child.on('error', (error: Error) => {
    failure = error
    pending?.reject(error)
  })
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
      if (!line) {
        continue
      }
      let frame: AcpFrame
      try {
        frame = JSON.parse(line) as AcpFrame
      } catch {
        continue
      }
      if (pending && pending.id === frame.id) {
        const waiter = pending
        pending = null
        waiter.resolve(frame)
      } else {
        frames.push(frame)
      }
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })
  return {
    take: (id, timeoutMs) =>
      new Promise<AcpFrame>((resolve, reject) => {
        if (failure) {
          reject(failure)
          return
        }
        const buffered = frames.findIndex((frame) => frame.id === id)
        if (buffered !== -1) {
          resolve(frames.splice(buffered, 1)[0])
          return
        }
        const timer = setTimeout(() => {
          pending = null
          reject(new Error(`Qoder ACP did not answer request ${id}. stderr:\n${stderr}`))
        }, timeoutMs)
        pending = {
          id,
          resolve: (frame) => {
            clearTimeout(timer)
            resolve(frame)
          },
          reject: (error) => {
            clearTimeout(timer)
            reject(error)
          }
        }
      })
  }
}

function writeFrame(child: ChildProcessWithoutNullStreams, frame: unknown): void {
  child.stdin.write(`${JSON.stringify(frame)}\n`)
}

function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number
): Promise<{ code: number | null; signal: NodeJS.Signals | null } | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs)
    const settle = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer)
      resolve({ code, signal })
    }
    // A child that never spawned closes without exiting.
    child.once('exit', settle)
    child.once('close', settle)
    if (child.exitCode !== null || child.signalCode !== null) {
      settle(child.exitCode, child.signalCode)
    }
  })
}

/** The CLI should end on stdin EOF; a stubborn child is terminated so the suite never hangs. */
async function endSession(
  child: ChildProcessWithoutNullStreams
): Promise<{ code: number | null; signal: NodeJS.Signals | null } | null> {
  // A binary that never started has no process to wait for.
  if (child.pid === undefined) {
    return null
  }
  child.stdin.end()
  const exited = await waitForExit(child, EXIT_TIMEOUT_MS)
  if (exited) {
    return exited
  }
  child.kill('SIGTERM')
  const terminated = await waitForExit(child, KILL_TIMEOUT_MS)
  if (terminated) {
    return terminated
  }
  child.kill('SIGKILL')
  return waitForExit(child, KILL_TIMEOUT_MS)
}

it.skipIf(process.env.ORCA_REAL_QODER_CLI_TEST !== '1')(
  'completes a real Qoder ACP handshake',
  async () => {
    const spec = QODER_ACP_LAUNCH_SPECS.find((candidate) => candidate.agent === 'qoder')
    if (!spec) {
      throw new Error('The Qoder ACP launch spec is missing')
    }
    // Orca launches the agent in the user's workspace, so the handshake runs in the same place.
    const workspace = process.cwd()
    const args = spec.args({ fullAccess: false, pluginDir: null })
    const child = spawnProcess({
      program: spec.command,
      args,
      cwd: workspace,
      env: launchEnvironment(spec),
      stdio: 'pipe'
    })
    const frames = readAcpFrames(child)
    let exit: { code: number | null; signal: NodeJS.Signals | null } | null = null
    try {
      writeFrame(child, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: ACP_PROTOCOL_VERSION,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false
          }
        }
      })
      const initialized = await frames.take(1, HANDSHAKE_TIMEOUT_MS)
      expect(
        initialized.error,
        `Qoder ACP initialize failed: ${JSON.stringify(initialized.error)}`
      ).toBeUndefined()
      expect(initialized.result?.protocolVersion).toBe(ACP_PROTOCOL_VERSION)
      expect(initialized.result?.agentCapabilities).toBeTruthy()

      writeFrame(child, {
        jsonrpc: '2.0',
        id: 2,
        method: 'session/new',
        params: { cwd: workspace, mcpServers: [] }
      })
      const created = await frames.take(2, HANDSHAKE_TIMEOUT_MS)
      expect(
        created.error,
        `Qoder ACP session/new failed: ${JSON.stringify(created.error)}`
      ).toBeUndefined()
      const sessionId = created.result?.sessionId
      expect(typeof sessionId).toBe('string')
      expect(sessionId).not.toBe('')

      const proofPath = process.env.ORCA_QODER_PROOF_PATH
      if (proofPath) {
        await writeFile(
          proofPath,
          JSON.stringify(
            {
              command: spec.command,
              args,
              cwd: workspace,
              protocolVersion: initialized.result?.protocolVersion,
              agentCapabilities: initialized.result?.agentCapabilities,
              sessionId
            },
            null,
            2
          )
        )
      }
    } finally {
      exit = await endSession(child)
    }
    expect(exit, 'The Qoder ACP process did not exit').not.toBeNull()
  },
  180_000
)
