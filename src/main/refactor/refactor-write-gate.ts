import path from 'node:path'

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit'])
const SEARCH_TOOLS = new Set(['Grep', 'Glob'])
const TOOL_INPUT_PATH_KEYS = ['file_path', 'filePath', 'path'] as const

/** Pulls the target path out of a tool input, following the repo's own path-key convention. */
export function refactorToolTargetPath(toolInput: Record<string, unknown>): string | null {
  for (const key of TOOL_INPUT_PATH_KEYS) {
    const value = toolInput[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value
    }
  }
  return null
}

/**
 * Why trailing dots and spaces: Win32 strips them from a component before it reads `.` / `..`, so
 * `.. ` means "parent directory" to the OS while `path.resolve` treats it as an ordinary child --
 * the gate would allow it and Windows would write the file outside the scratch root.
 */
function hasStrippableSegment(targetPath: string): boolean {
  return targetPath.split(/[\\/]/).some((segment) => /[. ]$/.test(segment))
}

/**
 * Why the case-sensitive comparison: a differently cased path is denied rather than allowed, even
 * on case-insensitive file systems, and the agent always writes the path it was given verbatim.
 * Why not the repo's `isPathInsideOrEqual`: it lowercases Windows-style paths before comparing,
 * which would undo exactly that.
 */
function isPathInside(rootPath: string, targetPath: string): boolean {
  const resolvedRoot = path.resolve(rootPath)
  const resolved = path.resolve(targetPath)
  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)
}

export function isPathInsideScratch(scratchRoot: string, targetPath: string): boolean {
  return isPathInside(scratchRoot, targetPath)
}

export function isPathInsideWorkspace(workspaceRoot: string, targetPath: string): boolean {
  return isPathInside(workspaceRoot, targetPath)
}

export function refactorToolAllowed(input: {
  toolName: string
  toolInput: Record<string, unknown>
  scratchRoot: string
  workspaceRoot: string
}): boolean {
  const { toolName, toolInput, scratchRoot, workspaceRoot } = input
  if (WRITE_TOOLS.has(toolName)) {
    const target = refactorToolTargetPath(toolInput)
    // Fail closed: a write without a recognisable path cannot be proven to land in the scratch root.
    if (target === null || hasStrippableSegment(target)) {
      return false
    }
    return isPathInsideScratch(scratchRoot, path.resolve(workspaceRoot, target))
  }
  if (toolName === 'Read') {
    const target = refactorToolTargetPath(toolInput)
    if (target === null || hasStrippableSegment(target)) {
      return false
    }
    return isPathInsideWorkspace(workspaceRoot, path.resolve(workspaceRoot, target))
  }
  if (SEARCH_TOOLS.has(toolName)) {
    const target = refactorToolTargetPath(toolInput)
    // Grep and Glob without a path search from the agent's cwd, which is the workspace root.
    if (target === null) {
      return true
    }
    if (hasStrippableSegment(target)) {
      return false
    }
    return isPathInsideWorkspace(workspaceRoot, path.resolve(workspaceRoot, target))
  }
  return false
}
