import { describe, expect, it } from 'vitest'
import type { ProcessSpec } from '@orca/process-host/process-spec'
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

describe('dispatchClaudeBackgroundAgent', () => {
  it('reads the new agent id out of the CLI output', async () => {
    const result = await dispatchClaudeBackgroundAgent(
      { prompt: 'do the thing' },
      deps('backgrounded · 4db4f587\n  claude agents  list sessions\n')
    )
    expect(result).toEqual({ ok: true, id: '4db4f587' })
  })

  it('passes the model and the permission mode', async () => {
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
    expect(seen.args).toEqual(['--bg', '--model', 'opus', '--permission-mode', 'plan', 'x'])
  })

  it('reports why the CLI refused', async () => {
    const result = await dispatchClaudeBackgroundAgent(
      { prompt: 'x' },
      deps('', 1, 'not logged in')
    )
    expect(result).toEqual({ ok: false, message: 'not logged in' })
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
    expect(seen.cwd).toBe('/repos/app')
  })

  it('fails when the CLI does not print an id', async () => {
    const result = await dispatchClaudeBackgroundAgent({ prompt: 'x' }, deps('nothing useful\n'))
    expect(result).toEqual({ ok: false, message: 'the CLI did not report why' })
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
})
