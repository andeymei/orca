import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ProcessSpec } from '@orca/process-host/process-spec'
import { CLAUDE_BACKGROUND_AGENTS_MAX_OUTPUT_BYTES } from '../../../shared/claude-background-agents'
import {
  dispatchClaudeBackgroundAgent,
  removeClaudeBackgroundAgent,
  stopClaudeBackgroundAgent
} from './claude-background-agent-commands'

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
      { prompt: 'x', cwd: '/repos/app' },
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
