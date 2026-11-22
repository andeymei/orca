import { describe, expect, it } from 'vitest'
import { cleanInlineSuggestion, looksLikeToolMarkup } from './completion-inline-text'

const PREFIX = 'const a = 1\nconst b = 2\n'
const SUFFIX = '\nreturn total\n'

describe('inline suggestion text', () => {
  it('keeps the answer the model wrote', () => {
    const cleaned = cleanInlineSuggestion('  const c = 3\n', { prefix: PREFIX, suffix: SUFFIX })

    expect(cleaned).toBe('  const c = 3')
  })

  it('takes the first fenced block and drops the talk around it', () => {
    const cleaned = cleanInlineSuggestion('```ts\nconst c = 3\n```\nThis completes it.', {
      prefix: PREFIX,
      suffix: SUFFIX
    })

    expect(cleaned).toBe('const c = 3')
  })

  it('drops the code the model repeated from before the cursor', () => {
    const cleaned = cleanInlineSuggestion('const b = 2\nconst c = 3', {
      prefix: PREFIX,
      suffix: SUFFIX
    })

    expect(cleaned).toBe('const c = 3')
  })

  it('drops the code the model repeated from after the cursor', () => {
    const cleaned = cleanInlineSuggestion('const c = 3\nreturn total\n', {
      prefix: PREFIX,
      suffix: SUFFIX
    })

    expect(cleaned).toBe('const c = 3')
  })

  it('drops the cursor marker the model echoed back', () => {
    const cleaned = cleanInlineSuggestion('<<<CURSOR>>>const c = 3', {
      prefix: PREFIX,
      suffix: SUFFIX
    })

    expect(cleaned).toBe('const c = 3')
  })

  it('leaves a short tail of the prefix alone, because it may be a coincidence', () => {
    const cleaned = cleanInlineSuggestion('ab', { prefix: 'ab', suffix: '' })

    expect(cleaned).toBe('ab')
  })

  it('knows tool markup is not code', () => {
    expect(looksLikeToolMarkup('<tool_call>{"name":"read"}</tool_call>')).toBe(true)
    expect(looksLikeToolMarkup('<function=read_file>')).toBe(true)
    expect(looksLikeToolMarkup('const c = 3')).toBe(false)
  })
})
