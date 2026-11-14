import { expect, it } from 'vitest'
import { createTestStore } from '../../testing/app-store-test-fixture'
import { aiInstructionFileKey } from './ai-instruction-entries'

it('keeps the published entries under the file key and clears them on null', () => {
  const store = createTestStore()
  const key = aiInstructionFileKey('w1', 'src/foo.ts')
  store.getState().publishAiInstructionEntries(key, [
    {
      lineNumber: 42,
      instruction: '甲',
      commentText: '// @ai 甲',
      contextExcerpt: '',
      contextStartLine: 42,
      contextEndLine: 42,
      status: 'pending'
    }
  ])
  expect(store.getState().getAiInstructionEntries(key)).toHaveLength(1)
  store.getState().publishAiInstructionEntries(key, null)
  expect(store.getState().getAiInstructionEntries(key)).toEqual([])
})

it('separates two workspaces that share a relative path', () => {
  expect(aiInstructionFileKey('w1', 'src/foo.ts')).not.toBe(
    aiInstructionFileKey('w2', 'src/foo.ts')
  )
})
