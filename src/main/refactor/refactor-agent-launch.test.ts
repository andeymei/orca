import { describe, expect, it } from 'vitest'
import { REFACTOR_DISALLOWED_TOOLS, resolveRefactorAgentLaunch } from './refactor-agent-launch'

describe('resolveRefactorAgentLaunch', () => {
  it('runs the agent in the workspace without bypassing the permission gate', async () => {
    const launch = await resolveRefactorAgentLaunch({
      cwd: '/repo',
      deps: {
        resolveCommand: () => ({ command: '/usr/bin/claude', prefixArgs: [] }),
        resolveAuthPolicy: () => ({ account: 'system' })
      }
    })
    expect(launch.cwd).toBe('/repo')
    expect(launch.pathToClaudeCodeExecutable).toBe('/usr/bin/claude')
    expect(launch.options.permissionMode).toBe('default')
    expect(launch.options.disallowedTools).toEqual(REFACTOR_DISALLOWED_TOOLS)
    expect(launch.options.settingSources).toEqual([])
    expect(launch.options.extraArgs?.['dangerously-skip-permissions']).toBeUndefined()
  })

  it('never auto-allows a write tool, so the gate always gets the decision', async () => {
    const launch = await resolveRefactorAgentLaunch({
      cwd: '/repo',
      deps: {
        resolveCommand: () => ({ command: '/usr/bin/claude', prefixArgs: [] }),
        resolveAuthPolicy: () => ({ account: 'system' })
      }
    })
    expect(launch.options.allowedTools).toBeUndefined()
  })

  it('keeps the shell, the subagent and the network out of reach', async () => {
    const launch = await resolveRefactorAgentLaunch({
      cwd: '/repo',
      deps: {
        resolveCommand: () => ({ command: '/usr/bin/claude', prefixArgs: [] }),
        resolveAuthPolicy: () => ({ account: 'system' })
      }
    })
    for (const tool of ['Bash', 'PowerShell', 'Task', 'Agent', 'WebFetch', 'WebSearch']) {
      expect(launch.options.disallowedTools).toContain(tool)
    }
  })
})
