import { describe, expect, it } from 'vitest'
import { parseClaudeBackgroundAgents } from './claude-background-agents'

describe('parseClaudeBackgroundAgents', () => {
  it('reads the agents the CLI lists', () => {
    const agents = parseClaudeBackgroundAgents(
      JSON.stringify([
        {
          pid: 14459,
          id: '8857ad86',
          cwd: '/repos/app',
          kind: 'background',
          sessionId: '8857ad86-88ad-4680-81f9-861c71626bb0',
          name: 'init orca (2)',
          status: 'idle',
          state: 'blocked'
        }
      ])
    )
    expect(agents).toEqual([
      {
        id: '8857ad86',
        sessionId: '8857ad86-88ad-4680-81f9-861c71626bb0',
        name: 'init orca (2)',
        cwd: '/repos/app'
      }
    ])
  })

  it('leaves out an entry without an id', () => {
    const agents = parseClaudeBackgroundAgents(
      JSON.stringify([
        { sessionId: 'session-1', name: 'no id' },
        { id: 'id-1', sessionId: 'session-1' }
      ])
    )
    expect(agents.map((agent) => agent.id)).toEqual(['id-1'])
  })

  it('reads nothing from output that is not the listing', () => {
    expect(parseClaudeBackgroundAgents('not json')).toEqual([])
    expect(parseClaudeBackgroundAgents('{"agents":[]}')).toEqual([])
  })
})
