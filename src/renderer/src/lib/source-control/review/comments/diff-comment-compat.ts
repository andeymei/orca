import type { DiffComment, DiffCommentSource } from '../../../../../../shared/diff-comment-types'

export function getDiffCommentSource(comment: Pick<DiffComment, 'source'>): DiffCommentSource {
  if (comment.source === 'markdown') {
    return 'markdown'
  }
  if (comment.source === 'ai-instruction') {
    return 'ai-instruction'
  }
  return 'diff'
}

export function isDiffComment(comment: Pick<DiffComment, 'source'>): boolean {
  return getDiffCommentSource(comment) === 'diff'
}

export function isMarkdownComment(comment: Pick<DiffComment, 'source'>): boolean {
  return getDiffCommentSource(comment) === 'markdown'
}

export function isAiInstructionComment(comment: Pick<DiffComment, 'source'>): boolean {
  return getDiffCommentSource(comment) === 'ai-instruction'
}

/** Returns the input array itself when nothing is removed, keeping memoized consumers stable. */
export function withoutAiInstructionComments(comments: DiffComment[]): DiffComment[] {
  return comments.some(isAiInstructionComment)
    ? comments.filter((comment) => !isAiInstructionComment(comment))
    : comments
}

/** Returns the input array itself when every comment qualifies, keeping memoized consumers stable. */
export function onlyAiInstructionComments(comments: DiffComment[]): DiffComment[] {
  return comments.every(isAiInstructionComment)
    ? comments
    : comments.filter((comment) => isAiInstructionComment(comment))
}

export function getDiffCommentLineLabel(
  comment: Pick<DiffComment, 'lineNumber' | 'startLine'>,
  compact = false
): string {
  if (comment.startLine !== undefined && comment.startLine !== comment.lineNumber) {
    return compact
      ? `L${comment.startLine}-L${comment.lineNumber}`
      : `Lines ${comment.startLine}-${comment.lineNumber}`
  }
  return compact ? `L${comment.lineNumber}` : `Line ${comment.lineNumber}`
}
