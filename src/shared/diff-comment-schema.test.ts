import { describe, expect, it } from 'vitest'
import { DiffCommentSchema } from './diff-comment-schema'

describe('DiffCommentSchema', () => {
  it('keeps an AI instruction record with its dispatch state', () => {
    const parsed = DiffCommentSchema.parse({
      id: 'a1',
      worktreeId: 'w1',
      filePath: 'src/foo.ts',
      source: 'ai-instruction',
      selectedText: 'async function f() {}',
      startLine: 42,
      lineNumber: 42,
      body: '指数退避重试，最多 5 次',
      createdAt: 1_700_000_000_000,
      sentAt: 1_700_000_001_000,
      completedAt: 1_700_000_009_000,
      dispatchedPaneKey: 'tab-1:leaf-1',
      side: 'modified'
    })
    expect(parsed.source).toBe('ai-instruction')
    expect(parsed.completedAt).toBe(1_700_000_009_000)
    expect(parsed.dispatchedPaneKey).toBe('tab-1:leaf-1')
  })

  it('still rejects an unknown source', () => {
    expect(() =>
      DiffCommentSchema.parse({
        id: 'a2',
        worktreeId: 'w1',
        filePath: 'src/foo.ts',
        source: 'agent-instruction',
        lineNumber: 1,
        body: 'x',
        createdAt: 1,
        side: 'modified'
      })
    ).toThrow()
  })
})
