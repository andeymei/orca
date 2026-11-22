import { describe, expect, it } from 'vitest'
import { parseRefactorToolProgress } from './refactor-runner'
import { buildRefactorPrompt } from '../../shared/refactor/refactor-prompt'

describe('buildRefactorPrompt', () => {
  const prompt = buildRefactorPrompt({
    relativePath: 'src/foo.ts',
    sourceRelativePath: '_source/src/foo.ts',
    scratchRelativeRoot: '.orca/refactor/job-1',
    instruction: '把重复的校验提出来'
  })

  it('names the scratch directory the agent may write to', () => {
    expect(prompt.system).toContain('.orca/refactor/job-1')
  })

  it('tells the agent the source copy outranks the file on disk', () => {
    expect(prompt.system).toContain('_source/src/foo.ts')
  })

  it('requires the manifest to be written', () => {
    expect(prompt.system).toContain('manifest.json')
  })

  it('carries the user instruction into the prompt', () => {
    expect(prompt.user).toContain('把重复的校验提出来')
  })
})

describe('parseRefactorToolProgress', () => {
  it('names the file a write tool is writing, relative to the workspace', () => {
    const text = parseRefactorToolProgress(
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Write',
              input: { file_path: '/repo/.orca/refactor/job-1/p1/src/foo.ts' }
            }
          ]
        }
      },
      '/repo'
    )
    expect(text).toBe('正在写入 .orca/refactor/job-1/p1/src/foo.ts')
  })

  it('returns null for a message with no tool use', () => {
    expect(
      parseRefactorToolProgress(
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'hi' }] }
        },
        '/repo'
      )
    ).toBeNull()
  })
})
