import { expect, it } from 'vitest'
import type { ResolvedAiInstruction } from '@/components/editor/ai-instructions/ai-instruction-status'
import { createTestStore } from '../../testing/app-store-test-fixture'
import { aiInstructionFileKey } from './ai-instruction-entries'

it('keeps the published entries under the file key and clears them on null', () => {
  const store = createTestStore()
  const key = aiInstructionFileKey('w1', 'src/foo.ts')
  const entries: ResolvedAiInstruction[] = [
    {
      lineNumber: 42,
      instruction: '甲',
      commentText: '// @ai 甲',
      contextExcerpt: '',
      contextStartLine: 42,
      contextEndLine: 42,
      status: 'pending'
    }
  ]
  store.getState().publishAiInstructionEntries(key, entries)
  expect(store.getState().getAiInstructionEntries(key)).toHaveLength(1)
  // Why: the store keeps its own copy, so a later push by the caller cannot change what it holds.
  entries.push({
    lineNumber: 43,
    instruction: '乙',
    commentText: '// @ai 乙',
    contextExcerpt: '',
    contextStartLine: 43,
    contextEndLine: 43,
    status: 'pending'
  })
  expect(store.getState().getAiInstructionEntries(key)).toHaveLength(1)
  store.getState().publishAiInstructionEntries(key, null)
  expect(store.getState().getAiInstructionEntries(key)).toEqual([])
  // Why: a missing key must read as one stable array, or a selector re-renders on every commit.
  expect(store.getState().getAiInstructionEntries('never-published')).toBe(
    store.getState().getAiInstructionEntries('never-published')
  )
})

it('separates two workspaces that share a relative path', () => {
  expect(aiInstructionFileKey('w1', 'src/foo.ts')).not.toBe(
    aiInstructionFileKey('w2', 'src/foo.ts')
  )
})
