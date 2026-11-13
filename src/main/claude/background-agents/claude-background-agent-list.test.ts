import { describe, expect, it, vi } from 'vitest'
import { listClaudeBackgroundAgents } from './claude-background-agent-list'

describe('listClaudeBackgroundAgents', () => {
  it('reads the agents the CLI lists', async () => {
    const runCommand = vi.fn(async () => ({
      code: 0,
      signal: null,
      stdout: JSON.stringify([
        {
          id: '8857ad86',
          sessionId: '8857ad86-88ad-4680-81f9-861c71626bb0',
          name: 'agent',
          cwd: '/repos/app'
        }
      ]),
      stderr: '',
      timedOut: false
    }))
    const agents = await listClaudeBackgroundAgents({
      runCommand: runCommand as never,
      resolveCommand: (async () => '/usr/local/bin/claude') as never,
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
      runCommand: (async () => {
        throw new Error('the CLI must not run')
      }) as never,
      resolveCommand: (async () => null) as never,
      resolveEnvironment: async () => ({})
    })
    expect(agents).toEqual([])
  })

  it('reads nothing when the CLI fails', async () => {
    const agents = await listClaudeBackgroundAgents({
      runCommand: (async () => ({
        code: 1,
        signal: null,
        stdout: '',
        stderr: 'not installed',
        timedOut: false
      })) as never,
      resolveCommand: (async () => '/usr/local/bin/claude') as never,
      resolveEnvironment: async () => ({})
    })
    expect(agents).toEqual([])
  })
})
