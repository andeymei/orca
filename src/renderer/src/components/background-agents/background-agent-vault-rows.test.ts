import { describe, expect, it } from 'vitest'
import { backgroundAgentVaultRows } from './background-agent-vault-rows'
import type { AiVaultSession } from '../../../../shared/ai-vault/contracts/ai-vault-types'

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
    createdAt: '2026-11-12T09:00:00.000Z',
    updatedAt: '2026-11-12T10:00:00.000Z',
    modifiedAt: '2026-11-12T10:00:00.000Z',
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

describe('backgroundAgentVaultRows', () => {
  it('lists a session Orca can bring back', () => {
    const rows = backgroundAgentVaultRows([session({ sessionId: 'session-1' })], () => true)
    expect(rows.map((row) => row.sessionId)).toEqual(['session-1'])
  })

  it('leaves out a session Orca cannot bring back', () => {
    const rows = backgroundAgentVaultRows([session({ sessionId: 'session-1' })], () => false)
    expect(rows).toHaveLength(0)
  })

  it('leaves out a session with nothing in it', () => {
    const rows = backgroundAgentVaultRows(
      [session({ sessionId: 'session-1', messageCount: 0, previewMessages: [] })],
      () => true
    )
    expect(rows).toHaveLength(0)
  })

  it('lists the newest session first', () => {
    const rows = backgroundAgentVaultRows(
      [
        session({ sessionId: 'older', updatedAt: '2026-11-10T10:00:00.000Z' }),
        session({ sessionId: 'newer', updatedAt: '2026-11-12T10:00:00.000Z' })
      ],
      () => true
    )
    expect(rows.map((row) => row.sessionId)).toEqual(['newer', 'older'])
  })

  it('offers the newest sessions only', () => {
    const rows = backgroundAgentVaultRows(
      [
        session({ sessionId: 'older', updatedAt: '2026-11-10T10:00:00.000Z' }),
        session({ sessionId: 'newer', updatedAt: '2026-11-12T10:00:00.000Z' })
      ],
      () => true,
      1
    )
    expect(rows.map((row) => row.sessionId)).toEqual(['newer'])
  })
})
