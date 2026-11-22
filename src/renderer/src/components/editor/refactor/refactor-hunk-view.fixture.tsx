import { defineFixture } from '../../../component-fixtures/component-fixture'
import '@/lib/editor/monaco/monaco-setup'

import type { RefactorHunk } from '../../../../../shared/refactor/refactor-types'
import { RefactorHunkView } from './refactor-hunk-view'

const ACCEPTED_HUNK: RefactorHunk = {
  id: 'src/foo.ts:h1',
  originalStartLine: 12,
  originalLineCount: 8,
  modifiedStartLine: 12,
  modifiedLineCount: 4,
  originalText:
    'export function loadConfig(path: string): Config {\n' +
    '  const raw = readFileSync(path)\n' +
    '  const parsed = JSON.parse(raw)\n' +
    '  return parsed as Config\n' +
    '}\n',
  modifiedText:
    'export function loadConfig(path: string): Config {\n' +
    '  return parseConfig(readFileSync(path))\n' +
    '}\n'
}

const PENDING_HUNK: RefactorHunk = {
  id: 'src/foo.ts:h2',
  originalStartLine: 40,
  originalLineCount: 6,
  modifiedStartLine: 40,
  modifiedLineCount: 6,
  originalText:
    'function retry(times: number, work: () => void): void {\n' +
    '  for (let attempt = 0; attempt < times; attempt += 1) {\n' +
    '    work()\n' +
    '    return\n' +
    '  }\n' +
    '}\n',
  modifiedText:
    'function retry(times: number, work: () => void): void {\n' +
    '  for (let attempt = 0; attempt < times; attempt += 1) {\n' +
    '    try {\n' +
    '      work()\n' +
    '      return\n' +
    '    } catch {\n' +
    '      continue\n' +
    '    }\n' +
    '  }\n' +
    '}\n'
}

const OWNER_KEY = 'wt-1::refactor-review:job-1'

export const twoHunks = defineFixture({
  width: 1280,
  render: () => (
    <div className="flex flex-col">
      <RefactorHunkView
        hunk={ACCEPTED_HUNK}
        filePath="src/foo.ts"
        relativePath="src/foo.ts"
        ownerKey={OWNER_KEY}
        accepted
        sideBySide
        onToggleAccepted={() => {}}
      />
      <RefactorHunkView
        hunk={PENDING_HUNK}
        filePath="src/foo.ts"
        relativePath="src/foo.ts"
        ownerKey={OWNER_KEY}
        accepted={false}
        sideBySide
        onToggleAccepted={() => {}}
      />
    </div>
  )
})
