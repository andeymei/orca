import { describe, expect, it } from 'vitest'
import { RefactorManifest } from './refactor-manifest'
import { RefactorPlan } from './refactor-types'

describe('RefactorPlan', () => {
  it('parses a plan with one proposal and one hunk', () => {
    const parsed = RefactorPlan.safeParse({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      proposals: [
        {
          id: 'p1',
          title: '提取参数校验',
          rationale: '两处校验规则相同。',
          files: [
            {
              path: 'src/foo.ts',
              originalContent: 'if (!u.id) throw new Error()\n',
              hunks: [
                {
                  id: 'h1',
                  originalStartLine: 1,
                  originalLineCount: 1,
                  modifiedStartLine: 1,
                  modifiedLineCount: 1,
                  originalText: 'if (!u.id) throw new Error()\n',
                  modifiedText: 'assertUser(u)\n'
                }
              ]
            }
          ]
        }
      ]
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects a hunk whose original line count is negative', () => {
    const parsed = RefactorPlan.safeParse({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      proposals: [
        {
          id: 'p1',
          title: 't',
          rationale: 'r',
          files: [
            {
              path: 'src/foo.ts',
              originalContent: '',
              hunks: [
                {
                  id: 'h1',
                  originalStartLine: 1,
                  originalLineCount: -1,
                  modifiedStartLine: 1,
                  modifiedLineCount: 1,
                  originalText: '',
                  modifiedText: 'x'
                }
              ]
            }
          ]
        }
      ]
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects a hunk whose start line is zero', () => {
    const parsed = RefactorPlan.safeParse({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      proposals: [
        {
          id: 'p1',
          title: 't',
          rationale: 'r',
          files: [
            {
              path: 'src/foo.ts',
              originalContent: '',
              hunks: [
                {
                  id: 'h1',
                  originalStartLine: 0,
                  originalLineCount: 1,
                  modifiedStartLine: 1,
                  modifiedLineCount: 1,
                  originalText: '',
                  modifiedText: 'x'
                }
              ]
            }
          ]
        }
      ]
    })
    expect(parsed.success).toBe(false)
  })
})

describe('RefactorManifest', () => {
  it('accepts a proposal whose rationale is empty', () => {
    const parsed = RefactorManifest.safeParse({
      proposals: [{ id: 'p1', title: 't', rationale: '', files: ['src/foo.ts'] }]
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts a proposal that names no file', () => {
    // The agent writes the files and the index; an index that names a proposal without naming
    // its files is still an index.
    const parsed = RefactorManifest.safeParse({
      proposals: [{ id: 'p1', title: 't', rationale: 'r' }]
    })
    expect(parsed.success).toBe(true)
  })
})
