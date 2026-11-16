import { describe, expect, it } from 'vitest'
import {
  parseClaudeBackgroundAgents,
  readClaudeBackgroundAgentsListing
} from './claude-background-agents'

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
          startedAt: 14345,
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
        cwd: '/repos/app',
        kind: 'background',
        startedAt: 14345,
        state: 'blocked',
        status: 'idle'
      }
    ])
  })

  it('keeps the fields the supervisor needs', () => {
    const agents = parseClaudeBackgroundAgents(
      JSON.stringify([
        {
          pid: 14459,
          id: '8857ad86',
          cwd: '/repos/app',
          kind: 'background',
          sessionId: '8857ad86-88ad-4680-81f9-861c71626bb0',
          name: 'init orca (2)',
          startedAt: 14345,
          status: 'idle',
          state: 'blocked'
        }
      ])
    )
    expect(agents[0]).toMatchObject({
      kind: 'background',
      startedAt: 14345,
      state: 'blocked',
      status: 'idle'
    })
  })

  it('drops a state word it does not know', () => {
    const agents = parseClaudeBackgroundAgents(
      JSON.stringify([{ id: 'a', sessionId: 's', state: 'nonsense' }])
    )
    expect(agents[0].state).toBeUndefined()
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

describe('readClaudeBackgroundAgentsListing', () => {
  it('reads an empty list as an empty list', () => {
    expect(readClaudeBackgroundAgentsListing('[]')).toEqual({ ok: true, agents: [] })
  })

  it('says the answer cannot be used when the CLI printed something else', () => {
    expect(readClaudeBackgroundAgentsListing('not json')).toEqual({
      ok: false,
      message: 'the Claude Code CLI did not print JSON'
    })
    expect(readClaudeBackgroundAgentsListing('{"agents":[]}')).toEqual({
      ok: false,
      message: 'the Claude Code CLI did not print an agent list'
    })
  })
})
