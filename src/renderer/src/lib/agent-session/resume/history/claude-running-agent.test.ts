import { afterEach, describe, expect, it, vi } from 'vitest'
import { findRunningAgentForSession, runningAgentForSession } from './claude-running-agent'
import type { AiVaultSession } from '../../../../../../shared/ai-vault/contracts/ai-vault-types'
import type { ClaudeBackgroundAgent } from '../../../../../../shared/claude-background-agents'

const agent: ClaudeBackgroundAgent = {
  id: '8857ad86',
  sessionId: '8857ad86-88ad-4680-81f9-861c71626bb0',
  name: 'init orca (2)',
  cwd: '/repos/app'
}

function session(overrides: Partial<AiVaultSession> & { sessionId: string }): AiVaultSession {
  return {
    id: overrides.sessionId,
    executionHostId: 'local',
    agent: 'claude',
    title: 'a session',
    cwd: '/repos/app',
    branch: null,
    model: null,
    filePath: `/transcripts/${overrides.sessionId}.jsonl`,
    codexHome: null,
    createdAt: '2026-11-13T09:00:00.000Z',
    updatedAt: '2026-11-13T10:00:00.000Z',
    modifiedAt: '2026-11-13T10:00:00.000Z',
    messageCount: 12,
    totalTokens: 0,
    previewMessages: [],
    queuedMessageCount: 0,
    subagentTranscriptCount: 0,
    resumeCommand: `claude --resume ${overrides.sessionId}`,
    subagent: null,
    ...overrides
  }
}

describe('runningAgentForSession', () => {
  it('finds the agent that runs the conversation', () => {
    const running = runningAgentForSession(
      [agent],
      session({ sessionId: '8857ad86-88ad-4680-81f9-861c71626bb0' })
    )
    expect(running?.id).toBe('8857ad86')
  })

  it('leaves a conversation nobody runs alone', () => {
    expect(runningAgentForSession([agent], session({ sessionId: 'other-session' }))).toBeNull()
  })

  it("leaves another agent's conversation alone", () => {
    expect(
      runningAgentForSession(
        [agent],
        session({ sessionId: '8857ad86-88ad-4680-81f9-861c71626bb0', agent: 'codex' })
      )
    ).toBeNull()
  })

  it('finds a conversation that runs on another host', () => {
    // The listing comes from the host that owns the conversation, so its agents answer for it.
    expect(
      runningAgentForSession(
        [agent],
        session({
          sessionId: '8857ad86-88ad-4680-81f9-861c71626bb0',
          executionHostId: 'runtime:env-1'
        })
      )?.id
    ).toBe('8857ad86')
  })
})

describe('findRunningAgentForSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('asks the host that owns the conversation', async () => {
    const listRunningAgents = vi.fn(async () => [agent])
    vi.stubGlobal('window', { api: { aiVault: { listRunningAgents } } })
    const lookup = await findRunningAgentForSession(
      session({
        sessionId: '8857ad86-88ad-4680-81f9-861c71626bb0',
        executionHostId: 'runtime:env-1'
      })
    )
    expect(lookup).toEqual({ status: 'running', agent })
    expect(listRunningAgents).toHaveBeenCalledWith({ executionHostId: 'runtime:env-1' })
  })

  it('asks this machine for a conversation that runs here', async () => {
    const listRunningAgents = vi.fn(async () => [agent])
    vi.stubGlobal('window', { api: { aiVault: { listRunningAgents } } })
    await findRunningAgentForSession(
      session({ sessionId: '8857ad86-88ad-4680-81f9-861c71626bb0', executionHostId: 'local' })
    )
    expect(listRunningAgents).toHaveBeenCalledWith({ executionHostId: 'local' })
  })

  it('reports a host that runs nothing as idle', async () => {
    const listRunningAgents = vi.fn(async () => [])
    vi.stubGlobal('window', { api: { aiVault: { listRunningAgents } } })
    const lookup = await findRunningAgentForSession(
      session({ sessionId: '8857ad86-88ad-4680-81f9-861c71626bb0', executionHostId: 'local' })
    )
    expect(lookup).toEqual({ status: 'idle' })
  })

  it('leaves the decision to a host that cannot report', async () => {
    const listRunningAgents = vi.fn(async () => null)
    vi.stubGlobal('window', { api: { aiVault: { listRunningAgents } } })
    const lookup = await findRunningAgentForSession(
      session({
        sessionId: '8857ad86-88ad-4680-81f9-861c71626bb0',
        executionHostId: 'runtime:env-1'
      })
    )
    expect(lookup).toEqual({ status: 'unknown' })
  })
})
