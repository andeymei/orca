import { describe, expect, it } from 'vitest'

import { refactorAgentWrites } from './refactor-agent-writes'
import type { RefactorGateRoots } from './refactor-write-gate'

const roots: RefactorGateRoots = {
  scratchRoot: '/repo/.orca/refactor/job-1',
  workspaceRoot: '/repo',
  physicalScratchRoot: '/repo/.orca/refactor/job-1',
  physicalWorkspaceRoot: '/repo'
}

/** The frame the agent's tool call arrives in. */
function toolUse(id: string, filePath: string): Record<string, unknown> {
  return {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name: 'Write', input: { file_path: filePath } }] }
  }
}

/** The frame the tool's answer arrives in. */
function toolResult(id: string): Record<string, unknown> {
  return {
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] }
  }
}

describe('the writes the agent finished', () => {
  it('remembers a write whose tool answered', () => {
    const writes = refactorAgentWrites(roots)
    writes.note(toolUse('tool-1', '/repo/.orca/refactor/job-1/p1/src/foo.ts'))
    writes.note(toolResult('tool-1'))
    expect([...writes.completedKeys()]).toEqual(['p1/src/foo.ts'])
  })

  it('does not remember a write that never answered', () => {
    const writes = refactorAgentWrites(roots)
    writes.note(toolUse('tool-1', '/repo/.orca/refactor/job-1/p1/src/foo.ts'))
    expect([...writes.completedKeys()]).toEqual([])
  })

  it('does not remember a write outside the scratch tree', () => {
    const writes = refactorAgentWrites(roots)
    writes.note(toolUse('tool-1', '/repo/src/foo.ts'))
    writes.note(toolResult('tool-1'))
    expect([...writes.completedKeys()]).toEqual([])
  })

  it('reads the separator of the file the agent named', () => {
    const writes = refactorAgentWrites(roots)
    writes.note(toolUse('tool-1', '/repo/.orca/refactor/job-1/p1/src/foo.ts'))
    writes.note(toolResult('tool-1'))
    expect(writes.completedKeys().has('p1/src/foo.ts')).toBe(true)
  })
})
