import { describe, expect, it, vi } from 'vitest'
import { readClaudeBackgroundAgentJobState } from './claude-background-agent-job-state'

describe('readClaudeBackgroundAgentJobState', () => {
  it('reads the agent’s current activity', async () => {
    const detail = await readClaudeBackgroundAgentJobState('4f5d4302', {
      configDir: '/cfg',
      readFile: async (path) => {
        expect(path).toBe('/cfg/jobs/4f5d4302/state.json')
        return JSON.stringify({
          state: 'working',
          detail: '正在核对后台 agent 实现',
          needs: 'answer: 选 A 还是 B？',
          updatedAt: 1794729224070
        })
      }
    })
    expect(detail).toEqual({
      detail: '正在核对后台 agent 实现',
      needs: 'answer: 选 A 还是 B？',
      updatedAt: 1794729224070
    })
  })

  it('reads nothing when the file is gone', async () => {
    expect(
      await readClaudeBackgroundAgentJobState('4f5d4302', {
        configDir: '/cfg',
        readFile: async () => null
      })
    ).toBeNull()
  })

  it('reads nothing from a file it cannot parse', async () => {
    expect(
      await readClaudeBackgroundAgentJobState('4f5d4302', {
        configDir: '/cfg',
        readFile: async () => 'not json'
      })
    ).toBeNull()
  })

  it('copes with a state file that has no fields', async () => {
    expect(
      await readClaudeBackgroundAgentJobState('4f5d4302', {
        configDir: '/cfg',
        readFile: async () => '{}'
      })
    ).toEqual({ detail: null, needs: null, updatedAt: null })
  })

  it('reads the ISO timestamp the CLI writes as epoch ms', async () => {
    const detail = await readClaudeBackgroundAgentJobState('4f5d4302', {
      configDir: '/cfg',
      readFile: async () =>
        JSON.stringify({ detail: '正在核对后台 agent 实现', updatedAt: '2026-11-16T02:07:16.321Z' })
    })
    expect(detail?.updatedAt).toBe(1794794836321)
  })

  it('reads no timestamp from a string that is not one', async () => {
    const detail = await readClaudeBackgroundAgentJobState('4f5d4302', {
      configDir: '/cfg',
      readFile: async () => JSON.stringify({ detail: 'working', updatedAt: '5' })
    })
    expect(detail?.updatedAt).toBeNull()
  })

  it('reads nothing for an id that is not the short id the CLI prints', async () => {
    const readFile = vi.fn(async () => '{}')
    expect(
      await readClaudeBackgroundAgentJobState('../../etc/passwd', {
        configDir: '/cfg',
        readFile
      })
    ).toBeNull()
    expect(readFile).not.toHaveBeenCalled()
  })
})
