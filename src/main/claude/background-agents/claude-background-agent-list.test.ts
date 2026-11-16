import { describe, expect, it, vi } from 'vitest'
import type { ProcessResult, ProcessSpec } from '@orca/process-host/process-spec'
import {
  listClaudeBackgroundAgents,
  listClaudeBackgroundAgentsOrNull,
  type ClaudeBackgroundAgentAllFlagMemory
} from './claude-background-agent-list'

function result(overrides: Partial<ProcessResult>): ProcessResult {
  return { code: 0, signal: null, stdout: '', stderr: '', timedOut: false, ...overrides }
}

/** A memory of its own, so one case's refusal does not reach the next one. */
function allFlagMemory(): ClaudeBackgroundAgentAllFlagMemory {
  const refused = new Set<string>()
  return {
    refused: (program) => refused.has(program),
    remember: (program) => {
      refused.add(program)
    }
  }
}

describe('listClaudeBackgroundAgents', () => {
  it('reads the agents the CLI lists', async () => {
    const runCommand = vi.fn(async (_spec: ProcessSpec): Promise<ProcessResult> =>
      result({
        stdout: JSON.stringify([
          {
            id: '8857ad86',
            sessionId: '8857ad86-88ad-4680-81f9-861c71626bb0',
            name: 'agent',
            cwd: '/repos/app'
          }
        ])
      })
    )
    const agents = await listClaudeBackgroundAgents({
      runCommand,
      resolveCommand: async () => '/usr/local/bin/claude',
      resolveEnvironment: async () => ({})
    })
    expect(agents).toEqual([
      {
        id: '8857ad86',
        sessionId: '8857ad86-88ad-4680-81f9-861c71626bb0',
        name: 'agent',
        cwd: '/repos/app'
      }
    ])
    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        program: '/usr/local/bin/claude',
        args: ['agents', '--json', '--all']
      })
    )
  })

  it('asks for the completed agents too, because the Completed section and the delete path need them', async () => {
    // Why: `--json` prints the active sessions only, so without `--all` the Completed section is
    // permanently empty and `claude rm` is unreachable.
    const seen: { args?: readonly string[] } = {}
    await listClaudeBackgroundAgents({
      runCommand: async (spec: ProcessSpec) => {
        seen.args = spec.args
        return result({ stdout: '[]' })
      },
      resolveCommand: async () => '/usr/local/bin/claude',
      resolveEnvironment: async () => ({})
    })
    expect(seen.args).toContain('--all')
  })

  it('reads nothing when the CLI is not installed', async () => {
    const agents = await listClaudeBackgroundAgents({
      runCommand: async () => {
        throw new Error('the CLI must not run')
      },
      resolveCommand: async () => null,
      resolveEnvironment: async () => ({})
    })
    expect(agents).toEqual([])
  })

  it('reads nothing when the CLI fails', async () => {
    const agents = await listClaudeBackgroundAgents({
      runCommand: async () => result({ code: 1, stderr: 'not installed' }),
      resolveCommand: async () => '/usr/local/bin/claude',
      resolveEnvironment: async () => ({})
    })
    expect(agents).toEqual([])
  })

  it('reads nothing when the CLI prints something that is not a list', async () => {
    const agents = await listClaudeBackgroundAgents({
      runCommand: async () => result({ stdout: 'not json' }),
      resolveCommand: async () => '/usr/local/bin/claude',
      resolveEnvironment: async () => ({})
    })
    expect(agents).toEqual([])
  })
})

describe('a CLI that does not know --all', () => {
  it('asks again without the option and still lists the agents', async () => {
    // Why: a CLI without `--all` still knows `--json`, so the panel keeps working with an empty
    // Completed section instead of no roster at all.
    const seen: (readonly string[])[] = []
    const runCommand = vi.fn(async (spec: ProcessSpec): Promise<ProcessResult> => {
      seen.push(spec.args ?? [])
      if (seen.length === 1) {
        return result({ code: 1, stderr: "error: unknown option '--all'" })
      }
      return result({
        stdout: JSON.stringify([
          { id: '8857ad86', sessionId: '8857ad86-88ad-4680-81f9-861c71626bb0', name: 'agent' }
        ])
      })
    })
    const agents = await listClaudeBackgroundAgents({
      runCommand,
      resolveCommand: async () => '/usr/local/bin/claude-without-all',
      resolveEnvironment: async () => ({}),
      allFlagMemory: allFlagMemory()
    })
    expect(agents).toHaveLength(1)
    expect(seen).toEqual([
      ['agents', '--json', '--all'],
      ['agents', '--json']
    ])
  })

  it('does not ask a CLI that already refused the option again', async () => {
    // Why: the listing is polled every 15 seconds, so a refused option must not be asked again.
    const memory = allFlagMemory()
    const seen: (readonly string[])[] = []
    const runCommand = vi.fn(async (spec: ProcessSpec): Promise<ProcessResult> => {
      seen.push(spec.args ?? [])
      if (spec.args?.includes('--all')) {
        return result({ code: 1, stderr: "error: unknown option '--all'" })
      }
      return result({ stdout: '[]' })
    })
    const resolveCommand = async (): Promise<string> => '/usr/local/bin/claude-without-all-again'
    const resolveEnvironment = async (): Promise<NodeJS.ProcessEnv> => ({})
    await listClaudeBackgroundAgents({
      runCommand,
      resolveCommand,
      resolveEnvironment,
      allFlagMemory: memory
    })
    await listClaudeBackgroundAgents({
      runCommand,
      resolveCommand,
      resolveEnvironment,
      allFlagMemory: memory
    })
    expect(seen).toEqual([
      ['agents', '--json', '--all'],
      ['agents', '--json'],
      ['agents', '--json']
    ])
  })

  it('does not ask again when the CLI fails for another reason', async () => {
    const runCommand = vi.fn(async (_spec: ProcessSpec): Promise<ProcessResult> =>
      result({ code: 1, stderr: 'not installed' })
    )
    await expect(
      listClaudeBackgroundAgentsOrNull({
        runCommand,
        resolveCommand: async () => '/usr/local/bin/claude-broken',
        resolveEnvironment: async () => ({}),
        allFlagMemory: allFlagMemory()
      })
    ).rejects.toThrow('not installed')
    expect(runCommand).toHaveBeenCalledTimes(1)
  })

  it('does not ask again when the CLI refuses another option', async () => {
    const runCommand = vi.fn(async (_spec: ProcessSpec): Promise<ProcessResult> =>
      result({ code: 1, stderr: "error: unknown option '--bogus'" })
    )
    await expect(
      listClaudeBackgroundAgentsOrNull({
        runCommand,
        resolveCommand: async () => '/usr/local/bin/claude-other-flag',
        resolveEnvironment: async () => ({}),
        allFlagMemory: allFlagMemory()
      })
    ).rejects.toThrow("unknown option '--bogus'")
    expect(runCommand).toHaveBeenCalledTimes(1)
  })

  it('does not ask again when the CLI times out', async () => {
    const runCommand = vi.fn(async (_spec: ProcessSpec): Promise<ProcessResult> =>
      result({ timedOut: true })
    )
    await expect(
      listClaudeBackgroundAgentsOrNull({
        runCommand,
        resolveCommand: async () => '/usr/local/bin/claude-slow',
        resolveEnvironment: async () => ({}),
        allFlagMemory: allFlagMemory()
      })
    ).rejects.toThrow('the Claude Code CLI timed out')
    expect(runCommand).toHaveBeenCalledTimes(1)
  })

  it('fails when the CLI refuses the option and the retry fails too', async () => {
    const seen: (readonly string[])[] = []
    const runCommand = vi.fn(async (spec: ProcessSpec): Promise<ProcessResult> => {
      seen.push(spec.args ?? [])
      if (seen.length === 1) {
        return result({ code: 1, stderr: "error: unknown option '--all'" })
      }
      return result({ code: 1, stderr: 'the CLI fell over' })
    })
    await expect(
      listClaudeBackgroundAgentsOrNull({
        runCommand,
        resolveCommand: async () => '/usr/local/bin/claude-falls-over',
        resolveEnvironment: async () => ({}),
        allFlagMemory: allFlagMemory()
      })
    ).rejects.toThrow('the CLI fell over')
    expect(runCommand).toHaveBeenCalledTimes(2)
  })
})

describe('listClaudeBackgroundAgentsOrNull', () => {
  it('says the machine has no CLI when the CLI is not installed', async () => {
    const agents = await listClaudeBackgroundAgentsOrNull({
      runCommand: async () => {
        throw new Error('the CLI must not run')
      },
      resolveCommand: async () => null,
      resolveEnvironment: async () => ({})
    })
    expect(agents).toBeNull()
  })

  it('fails loudly when the CLI cannot answer', async () => {
    await expect(
      listClaudeBackgroundAgentsOrNull({
        runCommand: async () => result({ code: 1, stderr: 'not installed' }),
        resolveCommand: async () => '/usr/local/bin/claude',
        resolveEnvironment: async () => ({})
      })
    ).rejects.toThrow('not installed')
  })

  it('says the CLI failed when the CLI said nothing', async () => {
    await expect(
      listClaudeBackgroundAgentsOrNull({
        runCommand: async () => result({ code: 1, stderr: '   ' }),
        resolveCommand: async () => '/usr/local/bin/claude',
        resolveEnvironment: async () => ({})
      })
    ).rejects.toThrow('the Claude Code CLI failed')
  })

  it('fails loudly when the CLI answers with something that is not a list', async () => {
    await expect(
      listClaudeBackgroundAgentsOrNull({
        runCommand: async () => result({ stdout: 'not json' }),
        resolveCommand: async () => '/usr/local/bin/claude',
        resolveEnvironment: async () => ({})
      })
    ).rejects.toThrow('did not print JSON')
  })

  it('truncates a failure reason the panel cannot show', async () => {
    const message = await listClaudeBackgroundAgentsOrNull({
      runCommand: async () => result({ code: 1, stderr: 'x'.repeat(1000) }),
      resolveCommand: async () => '/usr/local/bin/claude',
      resolveEnvironment: async () => ({})
    }).then(
      () => null,
      (error: Error) => error.message
    )
    expect(message).toHaveLength(501)
    expect(message?.endsWith('…')).toBe(true)
  })
})
