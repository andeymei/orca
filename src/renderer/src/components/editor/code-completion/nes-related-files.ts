import { NES_CHARS_PER_TOKEN, trimNesTextAtLineBoundary } from './nes-context-builder'
import { readRuntimeFileContent } from '@/runtime/files/reads/runtime-file-read-client'
import { searchRuntimeFiles } from '@/runtime/files/search/runtime-file-search-client'
import { getRelativePathInsideWorktree } from '@/runtime/files/runtime-file-routing'
import type { RuntimeFileOperationArgs } from '@/runtime/files/runtime-file-client-types'
import type { SearchFileResult } from '../../../../../shared/file-search/code-search-types'
import {
  isRuntimePathAbsolute,
  normalizeRelativePath,
  normalizeRuntimePathForComparison,
  resolveRuntimePath
} from '../../../../../shared/cross-platform-path'
import { shouldIncludeQuickOpenPath } from '../../../../../shared/quick-open/quick-open-filter'

/**
 * How many related files a request carries, and how much of each one.
 *
 * A request goes out on every pause in typing, and every request pays for the whole context
 * again. Eight files of a thousand tokens each made a request about seven thousand tokens — for
 * a suggestion about one line — and the code around the cursor is what the answer is about.
 */
export const NES_RELATED_FILE_MAX = 3
export const NES_RELATED_FILE_TOKEN_BUDGET = 400
/**
 * How long the related-file search may hold up a suggestion. A remote host answers a full-text
 * search in seconds, and the suggestion the user is waiting for must not wait for it.
 */
export const NES_RELATED_FILES_BUDGET_MS = 400
// Why: an import can appear, or a related file change, while the feature sits idle on one buffer.
const NES_RELATED_FILES_CACHE_TTL_MS = 5_000

export type NesRelatedFile = { path: string; content: string; startLine: number }

export type NesRelatedFilesInput = {
  filePath: string
  fileText: string
  symbolAtCursor: string | null
  files: RuntimeFileOperationArgs
}

const MODULE_SPECIFIER_PATTERNS = [
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
]

const RELATIVE_IMPORT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx']
const RELATIVE_IMPORT_INDEX_FILES = ['/index.ts', '/index.tsx']
// Why: the cap counts matches, not files, so it must leave room for the files the ranking wants.
const SYMBOL_SEARCH_MAX_RESULTS = 200

type NesRelatedFilesCacheEntry = {
  symbolAtCursor: string | null
  files: NesRelatedFile[]
  collectedAt: number
}

const relatedFilesCache = new Map<string, Map<string, NesRelatedFilesCacheEntry>>()
// Why: a budgeted search keeps running after the caller gave up, so the next tick must join it
// instead of starting a second search the host would have to answer as well.
const inFlightSearches = new Map<string, Promise<NesRelatedFile[]>>()

/** The relative specifiers of a file, resolved against the file's own directory. */
export function parseRelativeImports(fileText: string, filePath: string): string[] {
  const directory = parentDirectoryOf(filePath)
  const resolved: string[] = []
  const seen = new Set<string>()
  for (const specifier of collectModuleSpecifiers(fileText)) {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      continue
    }
    const candidate = resolveRuntimePath(directory, specifier)
    if (seen.has(candidate)) {
      continue
    }
    seen.add(candidate)
    resolved.push(candidate)
  }
  return resolved
}

export async function collectNesRelatedFiles(
  input: NesRelatedFilesInput
): Promise<NesRelatedFile[]> {
  const byHost =
    relatedFilesCache.get(input.filePath) ?? new Map<string, NesRelatedFilesCacheEntry>()
  const hostKey = hostKeyOf(input.files)
  const cached = byHost.get(hostKey)
  if (cached) {
    if (Date.now() - cached.collectedAt >= NES_RELATED_FILES_CACHE_TTL_MS) {
      // Why: an expired entry is dead weight, so the map must not keep one stale entry per file.
      byHost.delete(hostKey)
    } else if (cached.symbolAtCursor === input.symbolAtCursor) {
      return [...cached.files]
    }
  }
  const searchKey = `${input.filePath}\0${hostKey}\0${input.symbolAtCursor ?? ''}`
  const running = inFlightSearches.get(searchKey)
  if (running) {
    return [...(await running)]
  }
  const search = gatherRelatedFiles(input)
  inFlightSearches.set(searchKey, search)
  try {
    const files = await search
    byHost.set(hostKey, {
      symbolAtCursor: input.symbolAtCursor,
      files: [...files],
      collectedAt: Date.now()
    })
    relatedFilesCache.set(input.filePath, byHost)
    return [...files]
  } finally {
    if (inFlightSearches.get(searchKey) === search) {
      inFlightSearches.delete(searchKey)
    }
  }
}

/**
 * The related files, or none when the search outlasts the budget. The search keeps running and
 * fills the cache, so the next tick has them; the plan is asked for without them meanwhile.
 */
export async function collectNesRelatedFilesWithinBudget(
  input: NesRelatedFilesInput,
  budgetMs: number = NES_RELATED_FILES_BUDGET_MS
): Promise<NesRelatedFile[]> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const budget = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), budgetMs)
  })
  try {
    return (await Promise.race([collectNesRelatedFiles(input), budget])) ?? []
  } finally {
    if (timer !== null) {
      clearTimeout(timer)
    }
  }
}

/** Two hosts can hold the same path, so a cached entry names the host it belongs to. */
function hostKeyOf(files: RuntimeFileOperationArgs): string {
  const connection = files.connectionId ?? ''
  const environment = files.target.kind === 'environment' ? files.target.environmentId : ''
  return `${connection}\0${environment}`
}

async function gatherRelatedFiles(input: NesRelatedFilesInput): Promise<NesRelatedFile[]> {
  const collected: NesRelatedFile[] = []
  const seen = new Set<string>()
  const currentPath = normalizeRuntimePathForComparison(input.filePath)
  const add = (file: NesRelatedFile): void => {
    const key = normalizeRuntimePathForComparison(file.path)
    if (seen.has(key) || key === currentPath) {
      return
    }
    seen.add(key)
    collected.push(file)
  }

  const importBases = parseRelativeImports(input.fileText, input.filePath).slice(
    0,
    NES_RELATED_FILE_MAX
  )
  const imported = await Promise.all(
    importBases.map((base) => readFirstReadableFile(input.files, base))
  )
  for (const file of imported) {
    if (file) {
      add(file)
    }
  }

  for (const path of await findSymbolFiles(input)) {
    if (collected.length >= NES_RELATED_FILE_MAX) {
      break
    }
    const file = await readRelatedFile(input.files, path)
    if (file) {
      add(file)
    }
  }

  return collected.slice(0, NES_RELATED_FILE_MAX)
}

/** The first candidate of a relative import that exists on disk. */
async function readFirstReadableFile(
  files: RuntimeFileOperationArgs,
  basePath: string
): Promise<NesRelatedFile | null> {
  for (const candidate of relatedFileCandidates(basePath)) {
    const file = await readRelatedFile(files, candidate)
    if (file) {
      return file
    }
  }
  return null
}

async function readRelatedFile(
  files: RuntimeFileOperationArgs,
  filePath: string
): Promise<NesRelatedFile | null> {
  try {
    const result = await readRuntimeFileContent({
      target: files.target,
      worktreeId: files.worktreeId ?? undefined,
      connectionId: files.connectionId,
      filePath,
      relativePath: getRelativePathInsideWorktree(files.worktreePath, filePath) ?? undefined
    })
    // Why: the model cannot read a PNG, and a file it cannot read is worth nothing to it.
    if (result.isBinary) {
      return null
    }
    return {
      path: filePath,
      content: trimNesTextAtLineBoundary(
        result.content,
        NES_RELATED_FILE_TOKEN_BUDGET * NES_CHARS_PER_TOKEN
      ),
      startLine: 1
    }
  } catch {
    // Why: a file that cannot be read is dropped; the reason is the model's business, not the user's.
    return null
  }
}

/** The files that mention the symbol at the cursor; the file that declares it comes first. */
async function findSymbolFiles(input: NesRelatedFilesInput): Promise<string[]> {
  const symbol = input.symbolAtCursor
  const worktreePath = input.files.worktreePath
  // Why: a search without a root path would sweep the whole filesystem.
  if (!symbol || !isPlainIdentifier(symbol) || !worktreePath) {
    return []
  }
  try {
    const result = await searchRuntimeFiles(input.files, {
      query: symbol,
      rootPath: worktreePath,
      maxResults: SYMBOL_SEARCH_MAX_RESULTS
    })
    // Why: the blocklist matches path segments, so it must see the root-relative path; an absolute one carries the workspace's ancestors.
    const authored = result.files.filter((file) =>
      shouldIncludeQuickOpenPath(normalizeRelativePath(file.relativePath))
    )
    return rankSymbolFiles(authored, symbol).map((file) =>
      isRuntimePathAbsolute(file.filePath)
        ? file.filePath
        : resolveRuntimePath(worktreePath, file.relativePath)
    )
  } catch {
    return []
  }
}

function rankSymbolFiles(files: SearchFileResult[], symbol: string): SearchFileResult[] {
  const definitionPattern = buildDefinitionPattern(symbol)
  const definitions: SearchFileResult[] = []
  const usages: SearchFileResult[] = []
  for (const file of files) {
    if (file.matches.some((match) => definitionPattern.test(match.lineContent))) {
      definitions.push(file)
    } else {
      usages.push(file)
    }
  }
  return [...definitions, ...usages]
}

function buildDefinitionPattern(symbol: string): RegExp {
  const name = escapeRegExp(symbol)
  const declaration = `(?:^|[^\\w$])(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:function\\s*\\*?|class|const|let|var|interface|type|enum)\\s+${name}\\b`
  const member = `^\\s*(?:(?:public|private|protected|static|readonly|abstract|override|async|get|set)\\s+)*\\*?\\s*${name}\\s*(?:<[^>]*>)?\\([^)]*\\)\\s*(?::[^={]+)?\\s*\\{`
  return new RegExp(`${declaration}|${member}`)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isPlainIdentifier(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)
}

function relatedFileCandidates(basePath: string): string[] {
  if (hasFileExtension(basePath)) {
    return [basePath]
  }
  return [
    basePath,
    ...RELATIVE_IMPORT_EXTENSIONS.map((extension) => `${basePath}${extension}`),
    ...RELATIVE_IMPORT_INDEX_FILES.map((indexFile) => `${basePath}${indexFile}`)
  ]
}

function hasFileExtension(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return name.includes('.')
}

function collectModuleSpecifiers(fileText: string): string[] {
  const specifiers: string[] = []
  for (const pattern of MODULE_SPECIFIER_PATTERNS) {
    for (const match of fileText.matchAll(pattern)) {
      const specifier = match[1]
      if (specifier) {
        specifiers.push(specifier)
      }
    }
  }
  return specifiers
}

function parentDirectoryOf(filePath: string): string {
  const trimmed = filePath.replace(/[\\/]+$/, '')
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (separator < 0) {
    return ''
  }
  if (separator === 0) {
    return '/'
  }
  if (separator === 2 && /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return trimmed.slice(0, 3)
  }
  return trimmed.slice(0, separator)
}
