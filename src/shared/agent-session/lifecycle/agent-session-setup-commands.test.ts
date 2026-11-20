import { describe, expect, it } from 'vitest'
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
  })
})
