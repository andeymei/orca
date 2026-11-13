import { describe, expect, it, vi } from 'vitest'
import type { ProcessResult, ProcessSpec } from '@orca/process-host/process-spec'
import { listClaudeBackgroundAgents } from './claude-background-agent-list'

function result(overrides: Partial<ProcessResult>): ProcessResult {
  return { code: 0, signal: null, stdout: '', stderr: '', timedOut: false, ...overrides }
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
      expect.objectContaining({ program: '/usr/local/bin/claude', args: ['agents', '--json'] })
    )
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
})
