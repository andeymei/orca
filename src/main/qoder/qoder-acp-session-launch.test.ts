import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { expect, it } from 'vitest'
import { runProcess, spawnProcess } from '@orca/process-host'
import { callAcpSession } from '../acp/protocol/acp-session-call'
import { AcpJsonRpcPeer } from '../acp/transport/acp-json-rpc-peer'
import {
  ACP_PROTOCOL_VERSION,
  InitializeResponseSchema,
  NewSessionResponseSchema
} from '../acp/generated/acp-protocol.generated'
import { QODER_ACP_LAUNCH_SPECS } from './qoder-acp-launch-spec'

type QoderAcpSpec = (typeof QODER_ACP_LAUNCH_SPECS)[number]
type ProcessExit = { code: number | null; signal: NodeJS.Signals | null }
type HandshakeAnswers = {
  protocolVersion: number
  agentCapabilities: unknown
  sessionId: string
}

/** The repo's scripted ACP CLI: it answers initialize and session/new over NDJSON. */
const SCRIPTED_ACP_CLI = join(
  import.meta.dirname,
  '..',
  'acp',
  '__fixtures__',
  'grok-acp-scripted-cli.mjs'
)

const HANDSHAKE_TIMEOUT_MS = 60_000
const EXIT_TIMEOUT_MS = 10_000
const KILL_TIMEOUT_MS = 5_000
const VERSION_TIMEOUT_MS = 20_000
const STDERR_TAIL_CHARS = 4_000

function inheritedEnvironment(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value
    }
  }
  return env
}

/** The child's environment: the inherited one, the account home the product pins, then the spec's. */
async function launchEnvironment(spec: QoderAcpSpec): Promise<Record<string, string>> {
  const env = inheritedEnvironment()
  // The product resolves the account from the launch environment and pins it in the child's env.
  const account = await spec.account.resolve({ launchEnv: env, stateDirectory: tmpdir() })
  Object.assign(env, spec.account.environment(account, env))
  for (const key of spec.scrubEnvironment?.(env, process.env) ?? []) {
    delete env[key]
  }
  Object.assign(env, spec.env)
  return env
}

/** The two builds are separate packages: a machine may have one and not the other. */
async function isInstalled(spec: QoderAcpSpec, env: Record<string, string>): Promise<boolean> {
  try {
    const version = await runProcess({
      program: spec.command,
      args: ['--version'],
      env,
      timeoutMs: VERSION_TIMEOUT_MS
    })
    return version.code === 0
  } catch {
    return false
  }
}

function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number
): Promise<ProcessExit | null> {
  return new Promise((resolve) => {
    // ast-grep-ignore: test-no-real-time-wait -- a child's exit has no condition to poll; the deadline is the bound
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
async function endSession(child: ChildProcessWithoutNullStreams): Promise<ProcessExit | null> {
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

/** The proof file records what each build answered, so a human can check it against `--resume`. */
async function writeProof(
  proofPath: string | undefined,
  builds: Record<string, unknown>[]
): Promise<void> {
  if (proofPath) {
    await writeFile(proofPath, JSON.stringify({ builds }, null, 2))
  }
}

/** The handshake the product sends, answered by the agent the program speaks ACP for. */
async function runHandshake(
  peer: AcpJsonRpcPeer,
  input: { cwd: string; timeoutMs: number }
): Promise<HandshakeAnswers> {
  const initialized = await callAcpSession(
    peer,
    'initialize',
    {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false
      },
      clientInfo: { name: 'orca', version: '1' }
    },
    InitializeResponseSchema,
    undefined,
    undefined,
    input.timeoutMs
  )
  const created = await callAcpSession(
    peer,
    'session/new',
    { cwd: input.cwd, mcpServers: [] },
    NewSessionResponseSchema,
    undefined,
    undefined,
    input.timeoutMs
  )
  return {
    protocolVersion: initialized.protocolVersion,
    agentCapabilities: initialized.agentCapabilities,
    sessionId: created.sessionId
  }
}

/**
 * Drives one ACP agent over stdio with the production peer, so the framing, the id
 * correlation, the timeout and the teardown are the same code the product runs.
 */
async function completeAcpHandshake(input: {
  program: string
  args: string[]
  cwd: string
  env: Record<string, string>
  timeoutMs: number
}): Promise<HandshakeAnswers & { exit: ProcessExit | null }> {
  const child = spawnProcess({
    program: input.program,
    args: input.args,
    cwd: input.cwd,
    env: input.env,
    stdio: 'pipe'
  })
  // A missing binary fails the spawn; the streams would error out unhandled.
  child.on('error', () => {})
  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    stream.on('error', () => {})
  }
  // Nobody reads the agent's stderr otherwise: the pipe fills and the agent stops writing.
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-STDERR_TAIL_CHARS)
  })
  const peer = new AcpJsonRpcPeer(
    child.stdout,
    child.stdin,
    {},
    { requestTimeoutMs: input.timeoutMs }
  )
  let answers: HandshakeAnswers | null = null
  let failure: Error | null = null
  let exit: ProcessExit | null = null
  try {
    answers = await runHandshake(peer, input)
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error))
  } finally {
    exit = await endSession(child)
    peer.close()
  }
  if (failure) {
    throw new Error(`The ACP handshake failed: ${failure.message}\nagent stderr:\n${stderr}`, {
      cause: failure
    })
  }
  if (!answers) {
    throw new Error('The ACP handshake produced no answers')
  }
  return { ...answers, exit }
}

// The scripted CLI answers in milliseconds; the bound only covers a slow machine.
it("completes an ACP handshake with the repo's scripted CLI", async () => {
  const handshake = await completeAcpHandshake({
    program: process.execPath,
    args: [SCRIPTED_ACP_CLI],
    cwd: process.cwd(),
    env: inheritedEnvironment(),
    timeoutMs: HANDSHAKE_TIMEOUT_MS
  })
  expect(handshake.protocolVersion).toBe(ACP_PROTOCOL_VERSION)
  expect(handshake.agentCapabilities).toBeTruthy()
  expect(handshake.sessionId).toBe('wsl-lane-grok-session')
  expect(handshake.exit, 'The scripted ACP process did not exit').not.toBeNull()
  expect(handshake.exit?.signal, 'The scripted ACP process was killed').not.toBe('SIGKILL')
}, 30_000)

it.skipIf(process.env.ORCA_REAL_QODER_CLI_TEST !== '1')(
  'completes a real Qoder ACP handshake',
  async () => {
    // The handshake runs in the directory the test was run from. It is not the workspace Orca
    // launches the agent in, so it proves the protocol and not the product's launch directory.
    const cwd = process.cwd()
    const builds: Record<string, unknown>[] = []
    const proofPath = process.env.ORCA_QODER_PROOF_PATH
    for (const spec of QODER_ACP_LAUNCH_SPECS) {
      const env = await launchEnvironment(spec)
      if (!(await isInstalled(spec, env))) {
        continue
      }
      const args = spec.args({ fullAccess: false, pluginDir: null })
      const handshake = await completeAcpHandshake({
        program: spec.command,
        args,
        cwd,
        env,
        timeoutMs: HANDSHAKE_TIMEOUT_MS
      })
      expect(handshake.protocolVersion).toBe(ACP_PROTOCOL_VERSION)
      expect(handshake.agentCapabilities).toBeTruthy()
      expect(handshake.sessionId).not.toBe('')
      expect(handshake.exit, 'The Qoder ACP process did not exit').not.toBeNull()
      // A SIGKILL means even SIGTERM failed, which is worth failing on.
      expect(handshake.exit?.signal, 'The Qoder ACP process was killed').not.toBe('SIGKILL')
      builds.push({
        agent: spec.agent,
        command: spec.command,
        args,
        cwd,
        protocolVersion: handshake.protocolVersion,
        agentCapabilities: handshake.agentCapabilities,
        sessionId: handshake.sessionId
      })
      // Written per build, so a later build's failure does not lose the earlier proof.
      await writeProof(proofPath, builds)
    }
    expect(builds.length, 'No Qoder build is installed').toBeGreaterThan(0)
  },
  180_000
)
