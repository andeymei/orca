import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../../../shared/agent-status/contracts/agent-status-types'
import { resolvePaneForegroundAgentType } from './pane-foreground-agent-type'

const PANE_KEY = 'tab-1:11111111-1111-4111-8111-111111111111'

function agentEntry(overrides: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    state: 'waiting',
    prompt: '',
    updatedAt: 0,
    stateStartedAt: 0,
    stateHistory: [],
    agentType: 'codex',
    paneKey: PANE_KEY,
    ...overrides
  }
}

describe('resolvePaneForegroundAgentType', () => {
  it('prefers the foreground agent over the status row', () => {
    expect(resolvePaneForegroundAgentType('claude', agentEntry())).toBe('claude')
  })

  it('falls back to the status row when no foreground agent is known', () => {
    expect(resolvePaneForegroundAgentType(null, agentEntry())).toBe('codex')
  })

  it('skips a restored row that describes a previous process', () => {
    expect(
      resolvePaneForegroundAgentType(null, agentEntry({ restoredUnconfirmed: true }))
    ).toBeNull()
  })

  it('knows no agent when neither source speaks', () => {
    expect(resolvePaneForegroundAgentType(null, undefined)).toBeNull()
    expect(resolvePaneForegroundAgentType(null, agentEntry({ agentType: undefined }))).toBeNull()
  })
})
