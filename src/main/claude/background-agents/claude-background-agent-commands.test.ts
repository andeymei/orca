import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ProcessSpec } from '@orca/process-host/process-spec'
import { CLAUDE_BACKGROUND_AGENTS_MAX_OUTPUT_BYTES } from '../../../shared/claude-background-agents'
import { PARENT_AGENT_SESSION_STAMP_ENV_KEYS } from '../../../shared/agent-launch/startup/parent-agent-session-env'
import {
  dispatchClaudeBackgroundAgent,
  removeClaudeBackgroundAgent,
  stopClaudeBackgroundAgent
} from './claude-background-agent-commands'

const stampKeys = new Set<string>(PARENT_AGENT_SESSION_STAMP_ENV_KEYS)

/** An environment that carries every session stamp the repo knows, plus the job dir. */
function environmentWithSessionStamps(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: '/usr/local/bin' }
  for (const key of PARENT_AGENT_SESSION_STAMP_ENV_KEYS) {
    env[key] = 'stamped'
  }
  env.CLAUDE_JOB_DIR = '/tmp/claude-jobs/4f5d4302'
  return env
}

const deps = (stdout: string, code = 0, stderr = '') => ({
  runCommand: async () => ({ code, signal: null, stdout, stderr, timedOut: false }),
  resolveCommand: async () => '/usr/local/bin/claude',
  resolveEnvironment: async () => ({})
})

/** A CLI that ended the way the test says it ended. */
const died = (result: {
  code: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
}) => ({
  runCommand: async () => ({ ...result, stdout: '', stderr: '' }),
  resolveCommand: async () => '/usr/local/bin/claude',
  resolveEnvironment: async () => ({})
})

describe('dispatchClaudeBackgroundAgent', () => {
  it('reads the new agent id out of the CLI output', async () => {
    const result = await dispatchClaudeBackgroundAgent(
      { prompt: 'do the thing' },
      deps('backgrounded · 4db4f587\n  claude agents  list sessions\n')
    )
    expect(result).toEqual({ ok: true, id: '4db4f587' })
  })

  it('reads the new agent id out of a colored answer', async () => {
    // Why: the CLI colors its answer when the environment asks for color (FORCE_COLOR=1), and the
    // panel then has to dispatch an agent instead of telling the user that no id was printed.
    const result = await dispatchClaudeBackgroundAgent(
      { prompt: 'x' },
      deps(
        'backgrounded · \u001b[36m4db4f587\u001b[39m\n\u001b[2m  claude agents             list sessions\n\u001b[2m  claude attach 4db4f587    open in this terminal\n'
      )
    )
    expect(result).toEqual({ ok: true, id: '4db4f587' })
  })

  it('reads the new agent id out of an answer whose words are colored too', async () => {
    const result = await dispatchClaudeBackgroundAgent(
      { prompt: 'x' },
      deps('\u001b[1mbackgrounded\u001b[22m · \u001b[36m4db4f587\u001b[39m\n')
    )
    expect(result).toEqual({ ok: true, id: '4db4f587' })
  })

  it('reads the new agent id out of an answer whose separator is colored', async () => {
    const result = await dispatchClaudeBackgroundAgent(
      { prompt: 'x' },
      deps('backgrounded\u001b[2m · \u001b[22m4db4f587\n')
    )
    expect(result).toEqual({ ok: true, id: '4db4f587' })
  })

  it('passes the model and the permission mode, and ends the options before the prompt', async () => {
    const seen: { args?: readonly string[] } = {}
    await dispatchClaudeBackgroundAgent(
      { prompt: 'x', model: 'opus', permissionMode: 'plan' },
      {
        ...deps('backgrounded · 4db4f587\n'),
        runCommand: async (spec) => {
          seen.args = spec.args
          return {
            code: 0,
            signal: null,
            stdout: 'backgrounded · 4db4f587\n',
            stderr: '',
            timedOut: false
          }
        }
      }
    )
    expect(seen.args).toEqual(['--bg', '--model', 'opus', '--permission-mode', 'plan', '--', 'x'])
  })

  it('reports why the CLI refused', async () => {
    const result = await dispatchClaudeBackgroundAgent(
      { prompt: 'x' },
      deps('', 1, 'not logged in')
    )
    expect(result).toEqual({ ok: false, message: 'not logged in' })
  })

  it('truncates a failure reason the panel cannot show', async () => {
    const result = await dispatchClaudeBackgroundAgent(
      { prompt: 'x' },
      deps('', 1, 'x'.repeat(1000))
    )
    expect(result).toEqual({ ok: false, message: `${'x'.repeat(500)}…` })
  })

  it('says the CLI reported nothing when it reported nothing', async () => {
    const result = await dispatchClaudeBackgroundAgent({ prompt: 'x' }, deps('', 1, ''))
    expect(result).toEqual({ ok: false, message: 'the CLI did not report why' })
  })

  it('runs in the given directory, because the CLI takes no --cwd', async () => {
    const seen: { cwd?: string } = {}
    await dispatchClaudeBackgroundAgent(
      { prompt: 'x', cwd: join('/repos', 'app') },
      {
        ...deps('backgrounded · 4db4f587\n'),
        runCommand: async (spec: ProcessSpec) => {
          seen.cwd = spec.cwd
          return {
            code: 0,
            signal: null,
            stdout: 'backgrounded · 4db4f587\n',
            stderr: '',
            timedOut: false
          }
        }
      }
    )
    expect(seen.cwd).toBe(join('/repos', 'app'))
  })

  it('caps the output it reads, so a runaway CLI cannot fill the panel', async () => {
    const seen: { maxOutputBytes?: number } = {}
    await dispatchClaudeBackgroundAgent(
      { prompt: 'x' },
      {
        ...deps('backgrounded · 4db4f587\n'),
        runCommand: async (spec: ProcessSpec) => {
          seen.maxOutputBytes = spec.maxOutputBytes
          return {
            code: 0,
            signal: null,
            stdout: 'backgrounded · 4db4f587\n',
            stderr: '',
            timedOut: false
          }
        }
      }
    )
    expect(seen.maxOutputBytes).toBe(CLAUDE_BACKGROUND_AGENTS_MAX_OUTPUT_BYTES)
  })

  it('fails when the CLI does not print an id', async () => {
    const result = await dispatchClaudeBackgroundAgent({ prompt: 'x' }, deps('nothing useful\n'))
    expect(result).toEqual({ ok: false, message: 'the CLI did not print an agent id' })
  })

  it('refuses an id that is longer than the CLI prints', async () => {
    // A truncated id would name another agent, so a longer hex run is not an id at all.
    const result = await dispatchClaudeBackgroundAgent(
      { prompt: 'x' },
      deps('backgrounded · 4db4f5879\n')
    )
    expect(result).toEqual({ ok: false, message: 'the CLI did not print an agent id' })
  })

  it('hands the abort signal to the CLI', async () => {
    const seen: { signal?: AbortSignal } = {}
    const controller = new AbortController()
    await dispatchClaudeBackgroundAgent(
      { prompt: 'x' },
      {
        ...deps('backgrounded · 4db4f587\n'),
        signal: controller.signal,
        runCommand: async (spec: ProcessSpec) => {
          seen.signal = spec.signal
          return {
            code: 0,
            signal: null,
            stdout: 'backgrounded · 4db4f587\n',
            stderr: '',
            timedOut: false
          }
        }
      }
    )
    expect(seen.signal).toBe(controller.signal)
  })

  it('fails when the CLI is not installed', async () => {
    const result = await dispatchClaudeBackgroundAgent(
      { prompt: 'x' },
      {
        runCommand: async () => {
          throw new Error('the CLI must not run')
        },
        resolveCommand: async () => null,
        resolveEnvironment: async () => ({})
      }
    )
    expect(result).toEqual({ ok: false, message: 'Claude Code CLI not found' })
  })
})

describe('the environment the CLI runs in', () => {
  it('hands the CLI no session stamp, so the dispatch starts a new agent', async () => {
    // Why: the CLI continues the session it finds in its environment, so a stamped environment
    // would hand the user their own session back instead of a new agent.
    let seen: NodeJS.ProcessEnv | undefined
    await dispatchClaudeBackgroundAgent(
      { prompt: 'x' },
      {
        ...deps('backgrounded · 4db4f587\n'),
        resolveEnvironment: async () => environmentWithSessionStamps(),
        runCommand: async (spec: ProcessSpec) => {
          seen = spec.env
          return {
            code: 0,
            signal: null,
            stdout: 'backgrounded · 4db4f587\n',
            stderr: '',
            timedOut: false
          }
        }
      }
    )
    expect(Object.keys(seen ?? {}).filter((key) => stampKeys.has(key))).toEqual([])
    expect(seen?.CLAUDE_JOB_DIR).toBeUndefined()
  })

  it('hands the removal no session stamp either, because it deletes for good', async () => {
    let seen: NodeJS.ProcessEnv | undefined
    await removeClaudeBackgroundAgent(
      { id: '4db4f587' },
      {
        ...deps('removed 4db4f587\n'),
        resolveEnvironment: async () => environmentWithSessionStamps(),
        runCommand: async (spec: ProcessSpec) => {
          seen = spec.env
          return {
            code: 0,
            signal: null,
            stdout: 'removed 4db4f587\n',
            stderr: '',
            timedOut: false
          }
        }
      }
    )
    expect(Object.keys(seen ?? {}).filter((key) => stampKeys.has(key))).toEqual([])
    expect(seen?.CLAUDE_JOB_DIR).toBeUndefined()
  })
})

describe('why a command failed', () => {
  it('says the dispatch was cancelled when the caller aborted it', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await dispatchClaudeBackgroundAgent(
      { prompt: 'x' },
      { ...died({ code: null, signal: 'SIGTERM', timedOut: false }), signal: controller.signal }
    )
    expect(result).toEqual({ ok: false, message: 'the dispatch was cancelled' })
  })

  it('says the CLI timed out when the CLI ran out of time', async () => {
    const result = await dispatchClaudeBackgroundAgent(
      { prompt: 'x' },
      died({ code: null, signal: 'SIGTERM', timedOut: true })
    )
    expect(result).toEqual({ ok: false, message: 'the CLI timed out' })
  })

  it('says the CLI was stopped when something else killed it', async () => {
    const result = await dispatchClaudeBackgroundAgent(
      { prompt: 'x' },
      died({ code: null, signal: 'SIGTERM', timedOut: false })
    )
    expect(result).toEqual({ ok: false, message: 'the CLI was stopped before it finished' })
  })
})

describe('the arguments the CLI takes', () => {
  it('refuses a permission mode the CLI does not know', async () => {
    const result = await dispatchClaudeBackgroundAgent(
      { prompt: 'x', permissionMode: 'bogus' },
      deps('backgrounded · 4db4f587\n')
    )
    expect(result).toEqual({ ok: false, message: 'not a permission mode' })
  })

  it('refuses a model that the CLI would read as an option', async () => {
    const result = await dispatchClaudeBackgroundAgent(
      { prompt: 'x', model: '--help' },
      deps('backgrounded · 4db4f587\n')
    )
    expect(result).toEqual({ ok: false, message: 'not a model name' })
  })
})

describe('the id guard', () => {
  it('refuses a name where an id belongs', async () => {
    // Two agents can share a name; `claude attach` accepts a partial name and would pick the wrong one.
    expect(await stopClaudeBackgroundAgent({ id: 'init orca' }, deps('stopped x'))).toEqual({
      ok: false,
      message: 'not a background agent id'
    })
    expect(await removeClaudeBackgroundAgent({ id: 'init orca' }, deps('removed x'))).toEqual({
      ok: false,
      message: 'not a background agent id'
    })
  })

  it('accepts the short id the CLI prints', async () => {
    expect(await stopClaudeBackgroundAgent({ id: '4db4f587' }, deps('stopped 4db4f587\n'))).toEqual(
      {
        ok: true,
        id: '4db4f587'
      }
    )
  })
})

describe('the commands the CLI takes', () => {
  it('stops an agent by its id', async () => {
    const seen: { args?: readonly string[] } = {}
    await stopClaudeBackgroundAgent(
      { id: '4db4f587' },
      {
        ...deps('stopped 4db4f587\n'),
        runCommand: async (spec) => {
          seen.args = spec.args
          return {
            code: 0,
            signal: null,
            stdout: 'stopped 4db4f587\n',
            stderr: '',
            timedOut: false
          }
        }
      }
    )
    expect(seen.args).toEqual(['stop', '4db4f587'])
  })

  it('removes an agent by its id', async () => {
    const seen: { args?: readonly string[] } = {}
    await removeClaudeBackgroundAgent(
      { id: '4db4f587' },
      {
        ...deps('removed 4db4f587\n'),
        runCommand: async (spec) => {
          seen.args = spec.args
          return {
            code: 0,
            signal: null,
            stdout: 'removed 4db4f587\n',
            stderr: '',
            timedOut: false
          }
        }
      }
    )
    expect(seen.args).toEqual(['rm', '4db4f587'])
  })

  it('reports why the CLI refused to remove an agent', async () => {
    const result = await removeClaudeBackgroundAgent(
      { id: '4db4f587' },
      deps('', 1, "No job matching '4db4f587'")
    )
    expect(result).toEqual({ ok: false, message: "No job matching '4db4f587'" })
  })

  it('gives the removal time to delete the worktree', async () => {
    const seen: { timeoutMs?: number | null } = {}
    await removeClaudeBackgroundAgent(
      { id: '4db4f587' },
      {
        ...deps('removed 4db4f587\n'),
        runCommand: async (spec) => {
          seen.timeoutMs = spec.timeoutMs
          return {
            code: 0,
            signal: null,
            stdout: 'removed 4db4f587\n',
            stderr: '',
            timedOut: false
          }
        }
      }
    )
    expect(seen.timeoutMs).toBe(30_000)
  })

  it('hands the abort signal to a stop, so a hanging command can be given up', async () => {
    const seen: { signal?: AbortSignal } = {}
    const controller = new AbortController()
    await stopClaudeBackgroundAgent(
      { id: '4db4f587' },
      {
        ...deps('stopped 4db4f587\n'),
        signal: controller.signal,
        runCommand: async (spec: ProcessSpec) => {
          seen.signal = spec.signal
          return {
            code: 0,
            signal: null,
            stdout: 'stopped 4db4f587\n',
            stderr: '',
            timedOut: false
          }
        }
      }
    )
    expect(seen.signal).toBe(controller.signal)
  })
})
