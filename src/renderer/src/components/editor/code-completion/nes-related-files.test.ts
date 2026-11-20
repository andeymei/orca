import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fsReadFile,
  fsSearch,
  installRuntimeFileClientEnvironment
} from '@/runtime/files/runtime-file-client-test-harness'
import type { RuntimeFileOperationArgs } from '@/runtime/files/runtime-file-client-types'
import { collectNesRelatedFiles, parseRelativeImports } from './nes-related-files'
import { readRuntimeFileContent } from '@/runtime/files/reads/runtime-file-read-client'

vi.mock('@/runtime/files/reads/runtime-file-read-client', async (importOriginal) => {
  const actual = await importOriginal<{
    readRuntimeFileContent: typeof readRuntimeFileContent
  }>()
  return { ...actual, readRuntimeFileContent: vi.fn(actual.readRuntimeFileContent) }
})

installRuntimeFileClientEnvironment()

const WORKTREE_PATH = '/repo'
const CURRENT_FILE = '/repo/src/app.ts'
const WINDOWS_WORKTREE_PATH = 'C:\\repo'
const WINDOWS_FILE = 'C:\\repo\\src\\app.ts'
const BLOCKED_ANCESTOR_WORKTREE_PATH = '/home/user/.cache/repo'
const BLOCKED_ANCESTOR_FILE = '/home/user/.cache/repo/src/app.ts'

const contents = new Map<string, string>([
  ['/repo/src/util.ts', 'export const util = 1'],
  ['/repo/shared/thing.ts', 'export const thing = 2'],
  ['/repo/src/helper.ts', 'export function helper() {}'],
  ['/repo/src/caller.ts', 'helper()']
])
const binaryPaths = new Set<string>()

function filesContext(overrides: Partial<RuntimeFileOperationArgs> = {}): RuntimeFileOperationArgs {
  return {
    target: { kind: 'local' },
    worktreeId: 'wt-1',
    worktreePath: WORKTREE_PATH,
    ...overrides
  }
}

function searchResult(
  files: { filePath: string; relativePath: string; lineContent: string }[]
): unknown {
  return {
    files: files.map((file) => ({
      filePath: file.filePath,
      relativePath: file.relativePath,
      matches: [{ line: 1, column: 1, matchLength: 6, lineContent: file.lineContent }]
    })),
    totalMatches: files.length,
    truncated: false
  }
}

/** The fake clock the cache lifetime is measured against. */
let now = 0

beforeEach(() => {
  // Why: the cache lives in this module and every test shares it, so each test starts past the
  // entries the previous one left behind.
  now += 5_000
  vi.spyOn(Date, 'now').mockReturnValue(now)
  binaryPaths.clear()
  vi.mocked(readRuntimeFileContent).mockClear()
  fsReadFile.mockImplementation(async ({ filePath }: { filePath: string }) => {
    const content = contents.get(filePath)
    if (content === undefined) {
      throw new Error(`ENOENT: ${filePath}`)
    }
    return { content, isBinary: binaryPaths.has(filePath) }
  })
  fsSearch.mockResolvedValue({ files: [], totalMatches: 0, truncated: false })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseRelativeImports', () => {
  it('resolves the relative specifiers against the file directory', () => {
    const imports = parseRelativeImports(
      "import { util } from './util'\nimport { thing } from '../shared/thing'\nimport React from 'react'\n",
      '/repo/src/app.ts'
    )

    expect(imports).toEqual(['/repo/src/util', '/repo/shared/thing'])
  })
})

describe('collectNesRelatedFiles', () => {
  it('resolves the relative imports of the current file', async () => {
    const related = await collectNesRelatedFiles({
      filePath: CURRENT_FILE,
      fileText: "import { util } from './util'\nimport { thing } from '../shared/thing'\n",
      symbolAtCursor: null,
      files: filesContext()
    })

    expect(related.map((file) => file.path)).toEqual(['/repo/src/util.ts', '/repo/shared/thing.ts'])
    expect(related.map((file) => file.startLine)).toEqual([1, 1])
    expect(related[0].content).toBe('export const util = 1')
    expect(vi.mocked(readRuntimeFileContent)).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/repo/src/util.ts',
        relativePath: 'src/util.ts',
        worktreeId: 'wt-1'
      })
    )
  })

  it('keeps a package import out of the results', async () => {
    const related = await collectNesRelatedFiles({
      filePath: CURRENT_FILE,
      fileText: "import React from 'react'\nimport { util } from './util'\n",
      symbolAtCursor: null,
      files: filesContext()
    })

    expect(related.map((file) => file.path)).toEqual(['/repo/src/util.ts'])
  })

  it('adds the files that mention the symbol at the cursor', async () => {
    fsSearch.mockResolvedValue(
      searchResult([
        {
          filePath: '/repo/src/caller.ts',
          relativePath: 'src/caller.ts',
          lineContent: 'helper()'
        },
        {
          filePath: '/repo/src/helper.ts',
          relativePath: 'src/helper.ts',
          lineContent: 'export function helper() {}'
        }
      ])
    )

    const related = await collectNesRelatedFiles({
      filePath: CURRENT_FILE,
      fileText: '',
      symbolAtCursor: 'helper',
      files: filesContext()
    })

    expect(related.map((file) => file.path)).toEqual(['/repo/src/helper.ts', '/repo/src/caller.ts'])
    expect(fsSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'helper', rootPath: WORKTREE_PATH })
    )
  })

  it('drops the vendored files from the search results', async () => {
    contents.set('/repo/node_modules/react/index.js', 'export function useState() {}')
    contents.set('/repo/src/hook.ts', 'export function useState() {}')
    fsSearch.mockResolvedValue(
      searchResult([
        {
          filePath: '/repo/node_modules/react/index.js',
          relativePath: 'node_modules/react/index.js',
          lineContent: 'export function useState() {}'
        },
        {
          filePath: '/repo/src/hook.ts',
          relativePath: 'src/hook.ts',
          lineContent: 'export function useState() {}'
        }
      ])
    )

    const related = await collectNesRelatedFiles({
      filePath: CURRENT_FILE,
      fileText: '',
      symbolAtCursor: 'useState',
      files: filesContext()
    })

    expect(related.map((file) => file.path)).toEqual(['/repo/src/hook.ts'])
  })

  it('drops the vendored files from a windows path', async () => {
    contents.set('C:\\repo\\node_modules\\react\\index.js', 'export function useState() {}')
    contents.set('C:\\repo\\src\\hook.ts', 'export function useState() {}')
    fsSearch.mockResolvedValue(
      searchResult([
        {
          filePath: 'C:\\repo\\node_modules\\react\\index.js',
          relativePath: 'node_modules\\react\\index.js',
          lineContent: 'export function useState() {}'
        },
        {
          filePath: 'C:\\repo\\src\\hook.ts',
          relativePath: 'src\\hook.ts',
          lineContent: 'export function useState() {}'
        }
      ])
    )

    const related = await collectNesRelatedFiles({
      filePath: WINDOWS_FILE,
      fileText: '',
      symbolAtCursor: 'useState',
      files: filesContext({ worktreePath: WINDOWS_WORKTREE_PATH })
    })

    expect(related.map((file) => file.path)).toEqual(['C:\\repo\\src\\hook.ts'])
  })

  it('keeps the search results when the workspace sits under a blocked ancestor', async () => {
    contents.set(`${BLOCKED_ANCESTOR_WORKTREE_PATH}/src/helper.ts`, 'export function helper() {}')
    fsSearch.mockResolvedValue(
      searchResult([
        {
          filePath: `${BLOCKED_ANCESTOR_WORKTREE_PATH}/src/helper.ts`,
          relativePath: 'src/helper.ts',
          lineContent: 'export function helper() {}'
        }
      ])
    )

    const related = await collectNesRelatedFiles({
      filePath: BLOCKED_ANCESTOR_FILE,
      fileText: '',
      symbolAtCursor: 'helper',
      files: filesContext({ worktreePath: BLOCKED_ANCESTOR_WORKTREE_PATH })
    })

    expect(related.map((file) => file.path)).toEqual([
      `${BLOCKED_ANCESTOR_WORKTREE_PATH}/src/helper.ts`
    ])
    // Why: the kept file is the only read of this case, so the count also pins the per-test mock history.
    expect(vi.mocked(readRuntimeFileContent)).toHaveBeenCalledTimes(1)
  })

  it('asks the search for enough matches to cover several files', async () => {
    await collectNesRelatedFiles({
      filePath: CURRENT_FILE,
      fileText: '',
      symbolAtCursor: 'helper',
      files: filesContext()
    })

    // Why: the cap counts matches, so it must leave room for the files the ranking wants.
    expect(fsSearch).toHaveBeenCalledWith(expect.objectContaining({ maxResults: 200 }))
  })

  it('never returns more than eight files', async () => {
    const manyFiles = Array.from({ length: 20 }, (_, index) => ({
      filePath: `/repo/src/file${index}.ts`,
      relativePath: `src/file${index}.ts`,
      lineContent: 'helper()'
    }))
    for (const file of manyFiles) {
      contents.set(file.filePath, 'export const value = 1')
    }
    fsSearch.mockResolvedValue(searchResult(manyFiles))

    const related = await collectNesRelatedFiles({
      filePath: CURRENT_FILE,
      fileText: '',
      symbolAtCursor: 'helper',
      files: filesContext()
    })

    expect(related).toHaveLength(8)
  })

  it('gives every file at most a thousand tokens', async () => {
    contents.set('/repo/src/big.ts', `${'x'.repeat(200)}\n${'y'.repeat(10_000)}`)

    const related = await collectNesRelatedFiles({
      filePath: CURRENT_FILE,
      fileText: "import './big'\n",
      symbolAtCursor: null,
      files: filesContext()
    })

    expect(related[0].content).toBe('x'.repeat(200))
  })

  it('cuts a one-line file at the budget', async () => {
    contents.set('/repo/src/one-line.ts', 'z'.repeat(10_000))

    const related = await collectNesRelatedFiles({
      filePath: CURRENT_FILE,
      fileText: "import './one-line'\n",
      symbolAtCursor: null,
      files: filesContext()
    })

    expect(related[0].content).toHaveLength(4000)
  })

  it('drops a file the model cannot read', async () => {
    binaryPaths.add('/repo/src/util.ts')

    const related = await collectNesRelatedFiles({
      filePath: CURRENT_FILE,
      fileText: "import './util'\n",
      symbolAtCursor: null,
      files: filesContext()
    })

    expect(related).toEqual([])
  })

  it('still resolves the relative imports when there is no worktree, and does not search', async () => {
    const related = await collectNesRelatedFiles({
      filePath: CURRENT_FILE,
      fileText: "import './util'\n",
      symbolAtCursor: 'helper',
      files: filesContext({ worktreePath: null })
    })

    expect(related.map((file) => file.path)).toEqual(['/repo/src/util.ts'])
    expect(fsSearch).not.toHaveBeenCalled()
  })

  it('keeps the collected files inside five seconds and re-reads them past it', async () => {
    const input = {
      filePath: CURRENT_FILE,
      fileText: '',
      symbolAtCursor: 'helper',
      files: filesContext()
    }
    fsSearch.mockResolvedValue(
      searchResult([
        {
          filePath: '/repo/src/helper.ts',
          relativePath: 'src/helper.ts',
          lineContent: 'export function helper() {}'
        }
      ])
    )
    await collectNesRelatedFiles(input)
    fsSearch.mockClear()

    // Why: a hit inside the lifetime is what keeps the search off every keystroke.
    now += 4_999
    vi.spyOn(Date, 'now').mockReturnValue(now)
    await collectNesRelatedFiles(input)
    expect(fsSearch).not.toHaveBeenCalled()

    // Why: past the lifetime the file may have gained an import or changed on disk.
    now += 1
    vi.spyOn(Date, 'now').mockReturnValue(now)
    await collectNesRelatedFiles(input)
    expect(fsSearch).toHaveBeenCalled()
  })

  it('keeps a separate cache entry for each host that holds the same path', async () => {
    const input = {
      filePath: CURRENT_FILE,
      fileText: '',
      symbolAtCursor: 'helper',
      files: filesContext()
    }
    fsSearch.mockResolvedValue(
      searchResult([
        {
          filePath: '/repo/src/helper.ts',
          relativePath: 'src/helper.ts',
          lineContent: 'export function helper() {}'
        }
      ])
    )
    await collectNesRelatedFiles(input)
    fsSearch.mockClear()

    await collectNesRelatedFiles({ ...input, files: filesContext({ connectionId: 'ssh-1' }) })
    expect(fsSearch).toHaveBeenCalled()
  })

  it('hands out a copy of the cached files', async () => {
    const input = {
      filePath: CURRENT_FILE,
      fileText: '',
      symbolAtCursor: 'helper',
      files: filesContext()
    }
    fsSearch.mockResolvedValue(
      searchResult([
        {
          filePath: '/repo/src/helper.ts',
          relativePath: 'src/helper.ts',
          lineContent: 'export function helper() {}'
        }
      ])
    )
    const first = await collectNesRelatedFiles(input)
    first.push({ path: '/repo/src/injected.ts', content: '', startLine: 1 })

    const second = await collectNesRelatedFiles(input)
    expect(second.map((file) => file.path)).toEqual(['/repo/src/helper.ts'])
  })
})
