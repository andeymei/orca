import { describe, expect, it, vi } from 'vitest'
import { buildClaudeBackgroundAgentListResult } from './claude-agents'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

describe('buildClaudeBackgroundAgentListResult', () => {
  it('pairs each agent with its own detail', async () => {
    const result = await buildClaudeBackgroundAgentListResult(
      async () => [{ id: '4db4f587', sessionId: 's', name: 'a', cwd: '/w' }],
      async (id) => ({ detail: `working on ${id}`, needs: null, updatedAt: 1 })
    )
    expect(result.status).toBe('ready')
    expect(Object.keys(result.details)).toEqual(['4db4f587'])
    expect(result.details['4db4f587'].detail).toBe('working on 4db4f587')
  })

  it('says so when this machine has no Claude Code CLI', async () => {
    const result = await buildClaudeBackgroundAgentListResult(
      async () => null,
      async () => ({ detail: null, needs: null, updatedAt: null })
    )
    expect(result.status).toBe('unsupported')
  })

  it('keeps the agents whose detail file cannot be read', async () => {
    const result = await buildClaudeBackgroundAgentListResult(
      async () => [{ id: '4db4f587', sessionId: 's', name: 'a', cwd: '/w' }],
      async () => null
    )
    expect(result.status).toBe('ready')
    expect(result.agents).toHaveLength(1)
    expect(result.details['4db4f587']).toBeUndefined()
  })

  it('reports a listing that failed instead of an empty one', async () => {
    const result = await buildClaudeBackgroundAgentListResult(
      async () => {
        throw new Error('the CLI timed out')
      },
      async () => null
    )
    expect(result.status).toBe('error')
    expect(result.message).toBe('the CLI timed out')
    expect(result.agents).toEqual([])
  })
})
