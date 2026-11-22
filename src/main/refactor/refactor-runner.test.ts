import { describe, expect, it } from 'vitest'
import {
  classifyRefactorResult,
  decideRefactorTurnOutcome,
  parseRefactorToolProgress,
  refactorFaultDetail,
  refactorTurnCancelledFirst
} from './refactor-runner'
import { buildRefactorPrompt } from '../../shared/refactor/refactor-prompt'

describe('buildRefactorPrompt', () => {
  const prompt = buildRefactorPrompt({
    relativePath: 'src/foo.ts',
    sourceRelativePath: '_source/src/foo.ts',
    scratchRelativeRoot: '.orca/refactor/job-1',
    instruction: '把重复的校验提出来'
  })

  it('names the only directory the agent may write to', () => {
    expect(prompt.system).toMatch(
      /你只能读工作区里的文件，只能写 `\.orca\/refactor\/job-1\/` 目录下的文件。/
    )
  })

  it('tells the agent the source copy outranks the file on disk', () => {
    expect(prompt.system).toMatch(/目标文件的当前内容以 `_source\/src\/foo\.ts` 为准/)
  })

  it('requires the manifest to be written', () => {
    expect(prompt.system).toMatch(/必须把方案索引写到 `\.orca\/refactor\/job-1\/manifest\.json`/)
  })

  it('carries the user instruction into the prompt', () => {
    expect(prompt.user).toMatch(/用户指令：\s*把重复的校验提出来/)
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

  it('names the file a read tool is reading', () => {
    const text = parseRefactorToolProgress(
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Read',
              input: { file_path: '/repo/.orca/refactor/job-1/p1/src/foo.ts' }
            }
          ]
        }
      },
      '/repo'
    )
    expect(text).toBe('正在读取 .orca/refactor/job-1/p1/src/foo.ts')
  })

  it('names an edit as a write', () => {
    const text = parseRefactorToolProgress(
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Edit',
              input: { file_path: '/repo/.orca/refactor/job-1/p1/src/foo.ts' }
            }
          ]
        }
      },
      '/repo'
    )
    expect(text).toBe('正在写入 .orca/refactor/job-1/p1/src/foo.ts')
  })

  it('names a multi-edit as a write', () => {
    const text = parseRefactorToolProgress(
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'MultiEdit',
              input: { file_path: '/repo/.orca/refactor/job-1/p1/src/foo.ts' }
            }
          ]
        }
      },
      '/repo'
    )
    expect(text).toBe('正在写入 .orca/refactor/job-1/p1/src/foo.ts')
  })

  it('returns null for an unknown tool name', () => {
    expect(
      parseRefactorToolProgress(
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'Bash',
                input: { file_path: '/repo/.orca/refactor/job-1/p1/src/foo.ts' }
              }
            ]
          }
        },
        '/repo'
      )
    ).toBeNull()
  })

  it('returns null when the tool input carries no path', () => {
    expect(
      parseRefactorToolProgress(
        {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', name: 'Write', input: { content: 'x' } }]
          }
        },
        '/repo'
      )
    ).toBeNull()
  })

  it('resolves a relative tool path against the workspace root', () => {
    const text = parseRefactorToolProgress(
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Write',
              input: { file_path: '.orca/refactor/job-1/p1/src/foo.ts' }
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

describe('classifyRefactorResult', () => {
  it('reads a clean success as done', () => {
    expect(
      classifyRefactorResult({ subtype: 'success', is_error: false, stop_reason: 'end_turn' })
    ).toEqual({ state: 'done', warnings: [] })
  })

  it('reads a success frame that carries an API error as failed', () => {
    const verdict = classifyRefactorResult({
      subtype: 'success',
      is_error: true,
      stop_reason: 'api_error',
      result: 'API Error: 500 Internal Server Error'
    })
    expect(verdict.state).toBe('failed')
    expect(verdict.warnings.join('\n')).toContain('API Error: 500 Internal Server Error')
  })

  const errorSubtypes = [
    'error_during_execution',
    'error_max_turns',
    'error_max_budget_usd',
    'error_max_structured_output_retries'
  ]

  for (const subtype of errorSubtypes) {
    it(`reads ${subtype} as failed, with the subtype and the stop reason`, () => {
      const verdict = classifyRefactorResult({
        subtype,
        is_error: true,
        stop_reason: `stopped_at_${subtype}`
      })
      expect(verdict.state).toBe('failed')
      expect(verdict.warnings.join('\n')).toContain(subtype)
      expect(verdict.warnings.join('\n')).toContain(`stopped_at_${subtype}`)
    })
  }

  it('reads a frame it does not recognise as failed', () => {
    expect(classifyRefactorResult({ subtype: 'something_new' }).state).toBe('failed')
  })
})

describe('decideRefactorTurnOutcome', () => {
  it('keeps a finished turn when the cancellation arrives after the result', () => {
    expect(
      decideRefactorTurnOutcome({
        result: { state: 'done', warnings: [] },
        cancelled: false,
        timedOut: false,
        fault: null
      })
    ).toEqual({ state: 'done', warnings: [] })
  })

  it('reports a cancellation that came before the result', () => {
    expect(
      decideRefactorTurnOutcome({
        result: null,
        cancelled: true,
        timedOut: false,
        fault: null
      })
    ).toEqual({ state: 'cancelled', warnings: ['任务已取消'] })
  })

  it('reports a timeout on its own, because a timeout is worth retrying', () => {
    expect(
      decideRefactorTurnOutcome({
        result: null,
        cancelled: false,
        timedOut: true,
        fault: null
      })
    ).toEqual({ state: 'timed_out', warnings: ['任务超时'] })
  })

  it('reports a crash with what the crash said', () => {
    const outcome = decideRefactorTurnOutcome({
      result: null,
      cancelled: false,
      timedOut: false,
      fault: 'the claude process exited with code 1'
    })
    expect(outcome.state).toBe('failed')
    expect(outcome.warnings.join('\n')).toContain('the claude process exited with code 1')
  })

  it('does not report a turn that never ended as done', () => {
    expect(
      decideRefactorTurnOutcome({
        result: null,
        cancelled: false,
        timedOut: false,
        fault: null
      })
    ).toEqual({ state: 'failed', warnings: ['这一轮没有结束'] })
  })
})

describe('refactorFaultDetail', () => {
  it('carries the diagnosis the SDK refused the session with', () => {
    const detail = refactorFaultDetail(
      new Error('claude stream-json exited', {
        cause: new Error('The process answering initialize does not honor onFailure')
      })
    )
    expect(detail).toContain('does not honor onFailure')
  })

  it('says the error itself when there is no cause', () => {
    expect(refactorFaultDetail(new Error('the CLI died'))).toBe('the CLI died')
  })
})

describe('refactorTurnCancelledFirst', () => {
  it('reports the cancellation when it came before the result', () => {
    expect(refactorTurnCancelledFirst({ cancelOrder: 1, resultOrder: 2 })).toBe(true)
  })

  it('does not report a cancellation that came after the result', () => {
    expect(refactorTurnCancelledFirst({ cancelOrder: 2, resultOrder: 1 })).toBe(false)
  })

  it('reports the cancellation when no result arrived', () => {
    expect(refactorTurnCancelledFirst({ cancelOrder: 1, resultOrder: -1 })).toBe(true)
  })

  it('reports no cancellation when none was requested', () => {
    expect(refactorTurnCancelledFirst({ cancelOrder: -1, resultOrder: 1 })).toBe(false)
  })
})
