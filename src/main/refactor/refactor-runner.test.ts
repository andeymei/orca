import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  classifyRefactorResult,
  decideRefactorTurnOutcome,
  parseRefactorToolProgress,
  readRefactorManifest,
  refactorFaultDetail,
  refactorTurnCancelledFirst,
  runRefactorTurn
} from './refactor-runner'
import { resolveRefactorGateRoots } from './refactor-write-gate'
import { buildRefactorPrompt } from '../../shared/refactor/refactor-prompt'
import {
  REFACTOR_MAX_FILES_PER_PROPOSAL,
  REFACTOR_MAX_PROPOSALS
} from '../../shared/refactor/refactor-limits'

const roots = await resolveRefactorGateRoots({
  scratchRoot: '/repo/.orca/refactor/job-1',
  workspaceRoot: '/repo'
})

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

  it('says the file list is required, so the agent does not leave it out', () => {
    expect(prompt.system).toMatch(/`files` 是必填项/)
  })

  it('names the same limits the plan builder enforces', () => {
    expect(prompt.system).toContain(
      `最多 ${REFACTOR_MAX_PROPOSALS} 个方案，每个方案最多 ${REFACTOR_MAX_FILES_PER_PROPOSAL} 个文件`
    )
    expect(prompt.system).toContain('最多 5 个方案，每个方案最多 5 个文件')
  })
})

describe('readRefactorManifest', () => {
  /** A scratch root that holds the manifest the agent wrote. */
  async function scratchRootWithManifest(manifest: unknown): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'refactor-manifest-'))
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest), 'utf8')
    return root
  }

  it('keeps the proposals that fit and drops only the one that does not', async () => {
    const root = await scratchRootWithManifest({
      proposals: [
        { id: 'p1', title: '提取校验', rationale: '两处规则相同。', files: ['src/foo.ts'] },
        { id: 'p2', rationale: '这个方案没有标题。' }
      ]
    })
    const read = await readRefactorManifest(root)
    expect(read.manifest?.proposals).toHaveLength(1)
    expect(read.manifest?.proposals[0].title).toBe('提取校验')
    expect(read.manifest?.proposals[0].rationale).toBe('两处规则相同。')
    expect(read.warnings).toHaveLength(1)
    expect(read.warnings[0]).toContain('p2')
  })

  it('keeps a proposal that names no file, so the plan can take its files from the tree', async () => {
    const root = await scratchRootWithManifest({
      proposals: [{ id: 'p1', title: '提取校验', rationale: '两处规则相同。' }]
    })
    const read = await readRefactorManifest(root)
    expect(read.manifest?.proposals).toHaveLength(1)
    expect(read.manifest?.proposals[0].title).toBe('提取校验')
    expect(read.manifest?.proposals[0].rationale).toBe('两处规则相同。')
    expect(read.manifest?.proposals[0].files).toBeUndefined()
    expect(read.warnings).toEqual([])
  })

  it('reads as missing when every proposal was dropped, so the scratch tree speaks', async () => {
    const root = await scratchRootWithManifest({
      proposals: [
        { id: 'p1', rationale: '这个方案没有标题。' },
        { id: 'p2', title: '合并读取' }
      ]
    })
    const read = await readRefactorManifest(root)
    expect(read.manifest).toBeNull()
    expect(read.warnings).toEqual([
      'The proposal p1 in the manifest does not have the expected shape; it was dropped',
      'The proposal p2 in the manifest does not have the expected shape; it was dropped'
    ])
  })

  it('keeps a manifest that really holds no proposal', async () => {
    const root = await scratchRootWithManifest({ proposals: [] })
    const read = await readRefactorManifest(root)
    expect(read.manifest).toEqual({ proposals: [] })
    expect(read.warnings).toEqual([])
  })

  it('fails the whole manifest when it holds no proposals array', async () => {
    const root = await scratchRootWithManifest({ note: '这个清单没有方案。' })
    const read = await readRefactorManifest(root)
    expect(read.manifest).toBeNull()
    expect(read.warnings).toEqual(['The manifest does not have the expected shape'])
  })

  it('fails the whole manifest when it is not JSON', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'refactor-manifest-'))
    await writeFile(path.join(root, 'manifest.json'), '{ not json', 'utf8')
    const read = await readRefactorManifest(root)
    expect(read.manifest).toBeNull()
    expect(read.warnings).toEqual(['The manifest is not valid JSON'])
  })
})

describe('runRefactorTurn', () => {
  /** A workspace with a scratch tree the agent never wrote a manifest into. */
  async function workspaceWithScratch(): Promise<{
    workspaceRoot: string
    scratchRoot: string
  }> {
    const workspaceRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'refactor-turn-')))
    const scratchRoot = path.join(workspaceRoot, '.orca', 'refactor', 'job-1')
    await mkdir(scratchRoot, { recursive: true })
    return { workspaceRoot, scratchRoot }
  }

  it('does not report a missing manifest when the turn already failed', async () => {
    const { workspaceRoot, scratchRoot } = await workspaceWithScratch()

    const turn = await runRefactorTurn({
      launch: {
        pathToClaudeCodeExecutable: '/usr/bin/claude',
        env: {},
        cwd: workspaceRoot,
        options: { permissionMode: 'default', allowedTools: ['Write(src/**)'] }
      },
      scratchRoot,
      workspaceRoot,
      prompt: { system: 'system', user: 'user' },
      signal: new AbortController().signal,
      openConnection: async (_launch, handlers) => {
        handlers.onMessage?.({
          type: 'result',
          subtype: 'success',
          is_error: true,
          result: 'Not logged in \u00b7 Please run /login',
          stop_reason: 'stop_sequence'
        })
        return { send: async () => undefined, close: async () => true }
      }
    })

    expect(turn.state).toBe('failed')
    // Why: the agent never ran, so it wrote no manifest; a second error about that file buries
    // the one that says why the turn ended.
    expect(turn.warnings).toEqual([
      'The refactoring ended in an error: Not logged in \u00b7 Please run /login'
    ])
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
      roots
    )
    expect(text).toBe('Writing .orca/refactor/job-1/p1/src/foo.ts')
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
      roots
    )
    expect(text).toBe('Reading .orca/refactor/job-1/p1/src/foo.ts')
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
      roots
    )
    expect(text).toBe('Writing .orca/refactor/job-1/p1/src/foo.ts')
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
      roots
    )
    expect(text).toBe('Writing .orca/refactor/job-1/p1/src/foo.ts')
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
        roots
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
        roots
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
      roots
    )
    expect(text).toBe('Writing .orca/refactor/job-1/p1/src/foo.ts')
  })

  it('returns null for a message with no tool use', () => {
    expect(
      parseRefactorToolProgress(
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'hi' }] }
        },
        roots
      )
    ).toBeNull()
  })

  it('names a file the CLI asked for by its real path as the path the user knows', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'refactor-progress-'))
    const linked = path.join(base, 'linked')
    await mkdir(path.join(linked, 'src'), { recursive: true })
    await symlink(linked, path.join(base, 'workspace'))
    const workspaceRoots = await resolveRefactorGateRoots({
      scratchRoot: path.join(base, 'workspace', '.orca', 'refactor', 'job-1'),
      workspaceRoot: path.join(base, 'workspace')
    })
    const text = parseRefactorToolProgress(
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Read',
              input: { file_path: path.join(await realpath(linked), 'src', 'foo.ts') }
            }
          ]
        }
      },
      workspaceRoots
    )
    expect(text).toBe('Reading src/foo.ts')
  })
})

describe('classifyRefactorResult', () => {
  it('reads a clean success as done', () => {
    expect(
      classifyRefactorResult({ subtype: 'success', is_error: false, stop_reason: 'end_turn' })
    ).toEqual({ state: 'done', warnings: [] })
  })

  it('does not name a stop reason that only says the turn ended', () => {
    // Why: the SDK stops a turn that died on an API error with an ordinary stop reason, so
    // naming it beside the error explains nothing the error does not already say.
    const verdict = classifyRefactorResult({
      subtype: 'success',
      is_error: true,
      stop_reason: 'stop_sequence',
      result: 'Not logged in \u00b7 Please run /login'
    })
    expect(verdict.state).toBe('failed')
    expect(verdict.warnings).toEqual([
      'The refactoring ended in an error: Not logged in \u00b7 Please run /login'
    ])
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

  it('says the refactoring ended in an error, in the words the user reads', () => {
    const verdict = classifyRefactorResult({
      subtype: 'error_during_execution',
      is_error: true,
      stop_reason: 'stopped_at_error_during_execution'
    })
    expect(verdict.warnings).toEqual([
      'The refactoring ended in an error: error_during_execution(stopped because: stopped_at_error_during_execution)'
    ])
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
    ).toEqual({ state: 'cancelled', warnings: ['The task was cancelled'] })
  })

  it('reports a timeout on its own, because a timeout is worth retrying', () => {
    expect(
      decideRefactorTurnOutcome({
        result: null,
        cancelled: false,
        timedOut: true,
        fault: null
      })
    ).toEqual({ state: 'timed_out', warnings: ['The task timed out'] })
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

  it('says the refactoring did not finish normally when the turn crashed', () => {
    const outcome = decideRefactorTurnOutcome({
      result: null,
      cancelled: false,
      timedOut: false,
      fault: 'the claude process exited with code 1'
    })
    expect(outcome.warnings).toEqual([
      'The refactoring did not finish normally: the claude process exited with code 1'
    ])
  })

  it('does not report a turn that never ended as done', () => {
    expect(
      decideRefactorTurnOutcome({
        result: null,
        cancelled: false,
        timedOut: false,
        fault: null
      })
    ).toEqual({ state: 'failed', warnings: ['The refactoring did not finish'] })
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
