import { describe, expect, it } from 'vitest'
import type { DiffComment } from '../../../../src/shared/diff-comment-types'
import { mergeDiffCommentMutation } from '../../../../src/shared/diff-comment-mutation'
import {
  normalizeMobileDiffComments,
  removeDeliveredMobileDiffComments
} from './mobile-diff-comments'

function comment(overrides: Partial<DiffComment> & Pick<DiffComment, 'id'>): DiffComment {
  const { id, ...rest } = overrides
  return {
    id,
    worktreeId: 'wt-1',
    filePath: 'src/app.ts',
    source: 'diff',
    lineNumber: 4,
    body: 'check this',
    createdAt: 100,
    side: 'modified',
    ...rest
  }
}

describe('mobile diff comments', () => {
  it('keeps a changed note when clearing an older delivered snapshot', () => {
    const delivered = comment({ id: 'a', body: 'old note' })

    expect(
      removeDeliveredMobileDiffComments(
        [comment({ id: 'a', body: 'new note' }), comment({ id: 'b' })],
        [delivered]
      )
    ).toEqual([comment({ id: 'a', body: 'new note' }), comment({ id: 'b' })])
  })

  it('drops AI instruction records so the phone cannot edit or delete them', () => {
    const normalized = normalizeMobileDiffComments(
      [
        comment({ id: 'ai', source: 'ai-instruction' }),
        comment({ id: 'note', source: 'diff' }),
        comment({ id: 'md', source: 'markdown' })
      ],
      'wt-1'
    )

    expect(normalized.map((entry) => entry.id)).toEqual(['note', 'md'])
  })

  it('leaves the desktop AI instruction record untouched when the phone saves its notes', () => {
    const phoneNotes = normalizeMobileDiffComments([comment({ id: 'note' })], 'wt-1')
    const desktopNotes = [
      comment({ id: 'ai', source: 'ai-instruction', sentAt: 5 }),
      comment({ id: 'note' })
    ]

    expect(mergeDiffCommentMutation(phoneNotes, desktopNotes, phoneNotes)).toEqual(desktopNotes)
  })
})
