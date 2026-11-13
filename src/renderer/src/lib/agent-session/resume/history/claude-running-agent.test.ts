import { describe, expect, it } from 'vitest'
import { runningAgentForSession } from './claude-running-agent'
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

  it('leaves a conversation that runs on another host alone', () => {
    expect(
      runningAgentForSession(
        [agent],
        session({
          sessionId: '8857ad86-88ad-4680-81f9-861c71626bb0',
          executionHostId: 'ssh:yolocalc'
        })
      )
    ).toBeNull()
  })
})
