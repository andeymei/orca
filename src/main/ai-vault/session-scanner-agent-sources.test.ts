import { expect, it } from 'vitest'
import { AI_VAULT_AGENT_SOURCES } from './session-scanner-agent-sources'
import { isDiscoverableSessionFile } from './session-file-discovery'

const PROJECTS_DIR = '/home/user/.claude/projects'
const LIVE = `${PROJECTS_DIR}/-srv-app/84693fdb-e203-4b59-81b1-ce59940554aa.jsonl`
const SUPERSEDED = `${PROJECTS_DIR}/-srv-app/84693fdb-e203-4b59-81b1-ce59940554aa.orphaned-1794567405571-216d030d.jsonl`

it('does not discover the transcript the CLI renamed when it superseded the conversation', () => {
  const source = AI_VAULT_AGENT_SOURCES.claude
  expect(isDiscoverableSessionFile(source, PROJECTS_DIR, LIVE)).toBe(true)
  expect(isDiscoverableSessionFile(source, PROJECTS_DIR, SUPERSEDED)).toBe(false)
})
