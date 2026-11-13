import { describe, expect, it } from 'vitest'
import {
  isSupersededClaudeTranscript,
  withoutSupersededClaudeTranscripts
} from './claude-superseded-transcript'

const LIVE = '/home/user/.claude/projects/-srv-app/84693fdb-e203-4b59-81b1-ce59940554aa.jsonl'
const SUPERSEDED =
  '/home/user/.claude/projects/-srv-app/84693fdb-e203-4b59-81b1-ce59940554aa.orphaned-1794567405571-216d030d.jsonl'

describe('isSupersededClaudeTranscript', () => {
  it('recognizes the transcript the CLI renamed when it superseded the conversation', () => {
    expect(isSupersededClaudeTranscript(SUPERSEDED)).toBe(true)
  })

  it('leaves a live transcript alone', () => {
    expect(isSupersededClaudeTranscript(LIVE)).toBe(false)
  })
})

describe('withoutSupersededClaudeTranscripts', () => {
  it('lists the conversation once', () => {
    const sessions = [
      { id: 'live', filePath: LIVE },
      { id: 'superseded', filePath: SUPERSEDED }
    ]
    expect(withoutSupersededClaudeTranscripts(sessions)).toEqual([{ id: 'live', filePath: LIVE }])
  })
})
