import path from 'node:path'

const READ_ONLY_TOOLS = new Set(['Read', 'Grep', 'Glob'])
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit'])
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

export function isPathInsideScratch(scratchRoot: string, targetPath: string): boolean {
  const resolvedRoot = path.resolve(scratchRoot)
  const resolved = path.resolve(targetPath)
  // Case-sensitive on purpose: a differently cased path is denied rather than allowed, even on
  // case-insensitive filesystems, and the agent always writes the path it was given verbatim.
  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)
}

export function refactorToolAllowed(input: {
  toolName: string
  toolInput: Record<string, unknown>
  scratchRoot: string
  workspaceRoot: string
}): boolean {
  if (READ_ONLY_TOOLS.has(input.toolName)) {
    return true
  }
  if (!WRITE_TOOLS.has(input.toolName)) {
    return false
  }
  const target = refactorToolTargetPath(input.toolInput)
  // Fail closed: a write without a recognisable path cannot be proven to land in the scratch root.
  if (target === null) {
    return false
  }
  return isPathInsideScratch(input.scratchRoot, path.resolve(input.workspaceRoot, target))
}
