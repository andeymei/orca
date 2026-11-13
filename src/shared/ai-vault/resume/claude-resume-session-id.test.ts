import { describe, expect, it } from 'vitest'
import { pinnableClaudeSessionId } from './claude-resume-session-id'

describe('pinnableClaudeSessionId', () => {
  it('accepts a conversation id', () => {
    expect(pinnableClaudeSessionId('84693fdb-e203-4b59-81b1-ce59940554aa')).toBe(
      '84693fdb-e203-4b59-81b1-ce59940554aa'
    )
  })

  it('refuses an id the CLI would reject', () => {
    expect(pinnableClaudeSessionId('session-1')).toBeNull()
    expect(pinnableClaudeSessionId('')).toBeNull()
    expect(pinnableClaudeSessionId(undefined)).toBeNull()
  })
})
