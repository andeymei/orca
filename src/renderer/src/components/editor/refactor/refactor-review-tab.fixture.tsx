import { defineFixture } from '../../../component-fixtures/component-fixture'
import '@/lib/editor/monaco/monaco-setup'

import type { RefactorHunk, RefactorPlan } from '../../../../../shared/refactor/refactor-types'
import { refactorReviewStore } from './refactor-review-store'
import { RefactorReviewTab } from './refactor-review-tab'

const ORIGINAL = [
  'export function loadConfig(path: string): Config {',
  '  const raw = readFileSync(path)',
  '  const parsed = JSON.parse(raw)',
  '  if (!parsed.id) {',
  '    throw new Error("missing id")',
  '  }',
  '  return parsed as Config',
  '}',
  ''
].join('\n')

const FIRST_HUNK: RefactorHunk = {
  id: 'src/foo.ts:h1',
  originalStartLine: 1,
  originalLineCount: 8,
  modifiedStartLine: 1,
  modifiedLineCount: 4,
  originalText: ORIGINAL,
  modifiedText: [
    'export function loadConfig(path: string): Config {',
    '  return parseConfig(readFileSync(path))',
    '}',
    ''
  ].join('\n')
}

const SECOND_HUNK: RefactorHunk = {
  id: 'src/foo.ts:h2',
  originalStartLine: 20,
  originalLineCount: 6,
  modifiedStartLine: 20,
  modifiedLineCount: 6,
  originalText: [
    'function retry(times: number, work: () => void): void {',
    '  for (let attempt = 0; attempt < times; attempt += 1) {',
    '    work()',
    '    return',
    '  }',
    '}'
  ].join('\n'),
  modifiedText: [
    'function retry(times: number, work: () => void): void {',
    '  for (let attempt = 0; attempt < times; attempt += 1) {',
    '    try {',
    '      work()',
    '      return',
    '    } catch {',
    '      continue',
    '    }',
    '  }',
    '}'
  ].join('\n')
}

const PLAN: RefactorPlan = {
  jobId: 'job-1',
  sourcePath: 'src/foo.ts',
  proposals: [
    {
      id: 'p1',
      title: '提取参数校验',
      rationale: '两处校验规则相同，合并后只需改一处',
      files: [
        {
          path: 'src/foo.ts',
          originalContent: ORIGINAL,
          hunks: [FIRST_HUNK, SECOND_HUNK]
        }
      ]
    },
    {
      id: 'p2',
      title: '简化嵌套条件',
      rationale: '嵌套只有两层，提前返回更易读',
      files: [
        {
          path: 'src/bar.ts',
          originalContent:
            'export const pick = (value: number) => {\n  return value > 0 ? 1 : 0\n}\n',
          hunks: [
            {
              id: 'src/bar.ts:h1',
              originalStartLine: 1,
              originalLineCount: 3,
              modifiedStartLine: 1,
              modifiedLineCount: 5,
              originalText:
                'export const pick = (value: number) => {\n  return value > 0 ? 1 : 0\n}\n',
              modifiedText:
                'export const pick = (value: number) => {\n  if (value <= 0) {\n    return 0\n  }\n  return 1\n}\n'
            }
          ]
        }
      ]
    }
  ]
}

export const withProposals = defineFixture({
  width: 1280,
  setup: () => {
    refactorReviewStore.setPlan('job-1', PLAN)
    // Why: the tab polls the job, and a fixture has no runtime to answer.
    window.api.runtime.call = async (request) => ({
      id: 'fixture-rpc',
      ok: true,
      result:
        request.method === 'refactor.status'
          ? { state: 'done', progress: '', warnings: [] }
          : { plan: PLAN },
      _meta: { runtimeId: 'fixture-runtime' }
    })
  },
  render: () => <RefactorReviewTab jobId="job-1" worktreeId="wt-1" relativePath="src/foo.ts" />
})
