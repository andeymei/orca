import { describe, expect, it } from 'vitest'
import { buildNesSystemPrompt, buildNesUserPrompt } from './code-completion-prompt'
import type { NesPromptInput } from './code-completion-types'

function buildPromptInput(overrides: Partial<NesPromptInput> = {}): NesPromptInput {
  return {
    filePath: '/repo/src/foo.ts',
    relativePath: 'src/foo.ts',
    languageId: 'typescript',
    prefix: 'const a = 1\n',
    suffix: '\nconst b = 2',
    prefixStartLine: 1,
    cursorLine: 2,
    cursorColumn: 1,
    relatedFiles: [],
    recentEdits: [],
    autoImport: false,
    ...overrides
  }
}

describe('buildNesUserPrompt', () => {
  it('marks the cursor with a sentinel that cannot appear in source', () => {
    const prompt = buildNesUserPrompt(buildPromptInput())

    expect(prompt).toContain('const a = 1\n<<<CURSOR>>>\nconst b = 2')
  })

  it('separates each file with a ###PATH: header', () => {
    const prompt = buildNesUserPrompt(
      buildPromptInput({
        relatedFiles: [{ path: '/repo/src/bar.ts', content: 'export const bar = 1', startLine: 1 }],
        recentEdits: [{ path: 'src/bar.ts', label: 'rename the helper' }]
      })
    )

    expect(prompt).toBe(
      [
        'Current file: src/foo.ts',
        'Language: typescript',
        '',
        '###PATH: /repo/src/foo.ts',
        'const a = 1',
        '<<<CURSOR>>>',
        'const b = 2',
        '',
        '###PATH: /repo/src/bar.ts',
        'export const bar = 1',
        '',
        'Recently accepted edits:',
        '- src/bar.ts: rename the helper'
      ].join('\n')
    )
  })

  it('includes the related files after the current one', () => {
    const prompt = buildNesUserPrompt(
      buildPromptInput({
        relatedFiles: [
          { path: '/repo/src/bar.ts', content: 'export const bar = 1', startLine: 1 },
          { path: '/repo/src/baz.ts', content: 'export const baz = 1', startLine: 1 }
        ]
      })
    )

    expect(prompt.indexOf('###PATH: /repo/src/foo.ts')).toBeLessThan(
      prompt.indexOf('###PATH: /repo/src/bar.ts')
    )
    expect(prompt.indexOf('###PATH: /repo/src/bar.ts')).toBeLessThan(
      prompt.indexOf('###PATH: /repo/src/baz.ts')
    )
    expect(prompt).toContain('export const bar = 1')
    expect(prompt).toContain('export const baz = 1')
  })

  it('lists the recently accepted edits', () => {
    const prompt = buildNesUserPrompt(
      buildPromptInput({
        recentEdits: [
          { path: 'src/bar.ts', label: 'rename the helper' },
          { path: 'src/baz.ts', label: 'drop the unused parameter' }
        ]
      })
    )

    expect(prompt).toContain(
      [
        'Recently accepted edits:',
        '- src/bar.ts: rename the helper',
        '- src/baz.ts: drop the unused parameter'
      ].join('\n')
    )
  })
})

describe('buildNesSystemPrompt', () => {
  it('asks for the missing import when auto import is on', () => {
    const prompt = buildNesSystemPrompt({ autoImport: true })

    expect(prompt).toContain('adds the import')
  })

  it('leaves the import rule out when auto import is off', () => {
    const prompt = buildNesSystemPrompt({ autoImport: false })

    expect(prompt).not.toContain('adds the import')
    expect(buildNesSystemPrompt()).not.toContain('adds the import')
  })

  it('asks for the path exactly as the path header carries it', () => {
    const prompt = buildNesSystemPrompt()

    expect(prompt).toContain('exactly as it appears after `###PATH:`')
  })

  it('counts the lines of each file on its own', () => {
    const prompt = buildNesSystemPrompt()

    expect(prompt).toContain("Count each file's lines separately")
    expect(prompt).toContain('the line right after its `###PATH:` header, is line 1 of that file')
  })

  it('states the ten rules in order', () => {
    const statements = [
      'Reply with a single JSON object of the form {"edits":[…]}',
      'Every edit carries id, path, kind, range, originalText, text and label',
      'Propose at most 5 edits',
      'and at most 2 edits per file',
      'A range is 1-based, its columns count UTF-16 code units',
      "Count each file's lines separately",
      'The edit at the cursor must end at the cursor position',
      'originalText must be the exact text the range currently covers',
      'label is a short human-readable intent',
      'When you have nothing to propose, answer {"edits":[]}'
    ]

    for (const prompt of [buildNesSystemPrompt(), buildNesSystemPrompt({ autoImport: true })]) {
      const positions = statements.map((statement) => prompt.indexOf(statement))

      expect(positions).not.toContain(-1)
      for (let index = 1; index < positions.length; index += 1) {
        expect(positions[index]).toBeGreaterThan(positions[index - 1])
      }
    }
  })
})
