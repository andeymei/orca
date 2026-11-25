/** Classify a workspace path as authored source, generated output, or neither so search can rank the
 * files a user actually edits above build churn. Pure path heuristics; callers own the transport. */
import {
  GENERATED_DIRECTORIES,
  GENERATED_DIRECTORY_PREFIXES,
  GENERATED_FILE_SUFFIXES,
  GENERATED_NAME_MARKERS,
  GENERATED_SOURCE_SUFFIXES,
  LOCKFILE_NAMES,
  VENDORED_DIRECTORIES
} from './generated-output-directories'

/** Authored source extensions; anything else is treated as configuration or other content. */
const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.py',
  '.pyi',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.kts',
  '.scala',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.cxx',
  '.hpp',
  '.hh',
  '.m',
  '.mm',
  '.cs',
  '.rb',
  '.php',
  '.swift',
  '.dart',
  '.lua',
  '.pl',
  '.r',
  '.jl',
  '.ex',
  '.exs',
  '.erl',
  '.clj',
  '.hs',
  '.ml',
  '.vb',
  '.zig',
  '.nim',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.vue',
  '.svelte',
  '.sql'
])

function fileName(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/')
  const slash = normalized.lastIndexOf('/')
  return slash === -1 ? normalized : normalized.slice(slash + 1)
}

function fileExtension(relativePath: string): string {
  const name = fileName(relativePath).toLowerCase()
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot)
}

function endsWithAny(lowerName: string, suffixes: readonly string[]): boolean {
  return suffixes.some((suffix) => lowerName.endsWith(suffix))
}

/** True when any path segment is a generated-output or vendored directory. */
function hasGeneratedDirectory(relativePath: string): boolean {
  const segments = relativePath.replace(/\\/g, '/').split('/')
  for (const segment of segments) {
    if (GENERATED_DIRECTORIES.has(segment) || VENDORED_DIRECTORIES.has(segment)) {
      return true
    }
    if (GENERATED_DIRECTORY_PREFIXES.some((prefix) => segment.startsWith(prefix))) {
      return true
    }
  }
  return false
}

/** True for a path under a build output tree, a file a generator rewrites, or a lockfile. */
export function isGeneratedSearchPath(relativePath: string): boolean {
  const lowerName = fileName(relativePath).toLowerCase()
  if (LOCKFILE_NAMES.has(lowerName)) {
    return true
  }
  if (endsWithAny(lowerName, GENERATED_FILE_SUFFIXES)) {
    return true
  }
  if (endsWithAny(lowerName, GENERATED_SOURCE_SUFFIXES)) {
    return true
  }
  if (GENERATED_NAME_MARKERS.some((marker) => lowerName.includes(marker))) {
    return true
  }
  return hasGeneratedDirectory(relativePath)
}

/** True for an authored source file that is not build output. */
export function isSourceSearchPath(relativePath: string): boolean {
  if (isGeneratedSearchPath(relativePath)) {
    return false
  }
  return SOURCE_EXTENSIONS.has(fileExtension(relativePath))
}

/**
 * Rank authored source above everything else, and build output below it.
 * Configuration, documentation and vendored code keep the order the search engine produced.
 */
export function searchFileRank(relativePath: string): number {
  if (isSourceSearchPath(relativePath)) {
    return 0
  }
  return isGeneratedSearchPath(relativePath) ? 2 : 1
}

/** Rank authored files first; ties keep the caller's original order. */
export function compareSearchFileRank(left: string, right: string): number {
  return searchFileRank(left) - searchFileRank(right)
}
