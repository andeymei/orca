import { describe, expect, it } from 'vitest'
import { TUI_AGENT_DISPLAY_NAMES } from '../../agent-launch/catalog/tui-agent-display-names'
import { agentSessionSetupFor, AGENT_SESSION_SETUP_COMMANDS } from './agent-session-setup-commands'

describe('Qoder setup commands', () => {
  it('signs in and installs the global build', () => {
    expect(agentSessionSetupFor('qoder')).toEqual({
      agent: 'qoder',
      loginCommand: ['qodercli', 'login'],
      installCommand: 'npm install -g @qoder-ai/qodercli'
    })
  })

  it('signs in and installs the China build under its own command', () => {
    expect(agentSessionSetupFor('qoder-cn')).toEqual({
      agent: 'qoder-cn',
      loginCommand: ['qoderclicn', 'login'],
      installCommand: 'npm install -g @qodercn-ai/qoderclicn'
    })
  })

  it('keeps one agent per row so the two builds never share an entry', () => {
    const agents = AGENT_SESSION_SETUP_COMMANDS.map((entry) => entry.agent)
    expect(new Set(agents).size).toBe(agents.length)
    // agentSessionSetupFor also matches the display name, so a name equal to another row's id
    // or name would shadow that row.
    const names = agents.map((agent) => TUI_AGENT_DISPLAY_NAMES[agent])
    expect(new Set(names).size).toBe(names.length)
    const ids = new Set<string>(agents)
    expect(names.filter((name) => ids.has(name))).toEqual([])
  })
})
