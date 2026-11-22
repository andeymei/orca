import path from 'node:path'
import { resolvePhysicalPath } from './refactor-physical-path'

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
 * Why the raw path: `path.resolve` folds only an exact `..`, so in `/repo/.. /../evil.ts` the `.. `
 * is an ordinary segment and the `..` after it pops that one, yielding `/repo/evil.ts` -- a path
 * that looks contained. The OS strips the space first and lands on `/evil` instead.
 */
export function hasUnsafePathSegment(targetPath: string): boolean {
  return targetPath.split(/[\\/]/).some((segment) => /[. ]$/.test(segment))
}

/**
 * The two roots of the gate, each with the location it really has.
 *
 * Why both spellings are kept: the refusal names the scratch root the agent was told, and the
 * comparison uses the place the root is on disk.
 */
export type RefactorGateRoots = {
  /** The scratch root as the agent was told it; a refusal names it. */
  scratchRoot: string
  /** The workspace root as the app knows it. */
  workspaceRoot: string
  /** Where the scratch root really is. */
  physicalScratchRoot: string
  /** Where the workspace root really is. */
  physicalWorkspaceRoot: string
}

/**
 * The roots the gate compares against.
 *
 * Why they are resolved once: every tool call names the same two directories, and the CLI
 * resolves its own working directory to the real path, so both sides of the comparison have to
 * be physical locations. Why it throws: a root that cannot be resolved leaves the gate nothing
 * to compare against, and a turn without a gate must not start.
 */
export async function resolveRefactorGateRoots(input: {
  scratchRoot: string
  workspaceRoot: string
}): Promise<RefactorGateRoots> {
  const [physicalScratchRoot, physicalWorkspaceRoot] = await Promise.all([
    resolvePhysicalPath(path.resolve(input.scratchRoot)),
    resolvePhysicalPath(path.resolve(input.workspaceRoot))
  ])
  if (physicalScratchRoot === null || physicalWorkspaceRoot === null) {
    throw new Error(
      `refactor roots could not be resolved: scratch ${input.scratchRoot} workspace ${input.workspaceRoot}`
    )
  }
  return {
    scratchRoot: input.scratchRoot,
    workspaceRoot: input.workspaceRoot,
    physicalScratchRoot,
    physicalWorkspaceRoot
  }
}

/**
 * Why the comparison is case sensitive: the physical paths come from the disk, which spells a
 * file the way it is stored, so two spellings of one file compare equal only where the disk
 * says they are the same file. A path the disk has never seen keeps the spelling it was given.
 */
function isInsidePhysicalRoot(physicalRoot: string, physicalTarget: string): boolean {
  if (physicalTarget === physicalRoot) {
    return true
  }
  const prefix = physicalRoot.endsWith(path.sep) ? physicalRoot : physicalRoot + path.sep
  return physicalTarget.startsWith(prefix)
}

/**
 * The target as an absolute path.
 *
 * Why it is not `path.resolve`: that folds a `..` lexically, while the kernel applies it to the
 * directory a link points at, so the two spellings can name different files.
 */
function absoluteTargetPath(workspaceRoot: string, target: string): string {
  if (path.isAbsolute(target)) {
    return target
  }
  return `${path.resolve(workspaceRoot)}${path.sep}${target}`
}

/** Whether the target lands inside the root, physically. Fail closed on a path that cannot be resolved. */
async function isInsidePhysicalRootOf(physicalRoot: string, targetPath: string): Promise<boolean> {
  const physicalTarget = await resolvePhysicalPath(targetPath)
  if (physicalTarget === null) {
    return false
  }
  return isInsidePhysicalRoot(physicalRoot, physicalTarget)
}

/**
 * `targetPath` must be absolute: the caller resolves relative paths against the workspace root,
 * since the scratch root and the workspace root are different bases.
 */
export async function isPathInsideScratch(
  scratchRoot: string,
  targetPath: string
): Promise<boolean> {
  return isPathInside(scratchRoot, targetPath)
}

/**
 * `targetPath` must be absolute: the caller resolves relative paths against the workspace root.
 */
export async function isPathInsideWorkspace(
  workspaceRoot: string,
  targetPath: string
): Promise<boolean> {
  return isPathInside(workspaceRoot, targetPath)
}

/** Whether the target lands inside the root, physically. */
async function isPathInside(rootPath: string, targetPath: string): Promise<boolean> {
  if (hasUnsafePathSegment(targetPath)) {
    return false
  }
  const physicalRoot = await resolvePhysicalPath(path.resolve(rootPath))
  if (physicalRoot === null) {
    return false
  }
  return isInsidePhysicalRootOf(physicalRoot, targetPath)
}

export async function refactorToolAllowed(input: {
  toolName: string
  toolInput: Record<string, unknown>
  roots: RefactorGateRoots
}): Promise<boolean> {
  const { toolName, toolInput, roots } = input
  if (WRITE_TOOLS.has(toolName)) {
    const target = refactorToolTargetPath(toolInput)
    // Fail closed: a write without a recognisable path cannot be proven to land in the scratch root.
    if (target === null || hasUnsafePathSegment(target)) {
      return false
    }
    return isInsidePhysicalRootOf(
      roots.physicalScratchRoot,
      absoluteTargetPath(roots.workspaceRoot, target)
    )
  }
  if (toolName === 'Read') {
    const target = refactorToolTargetPath(toolInput)
    if (target === null || hasUnsafePathSegment(target)) {
      return false
    }
    return isInsidePhysicalRootOf(
      roots.physicalWorkspaceRoot,
      absoluteTargetPath(roots.workspaceRoot, target)
    )
  }
  if (SEARCH_TOOLS.has(toolName)) {
    const target = refactorToolTargetPath(toolInput)
    // Grep and Glob without a path search from the agent's cwd, which is the workspace root.
    if (target === null) {
      return true
    }
    if (hasUnsafePathSegment(target)) {
      return false
    }
    return isInsidePhysicalRootOf(
      roots.physicalWorkspaceRoot,
      absoluteTargetPath(roots.workspaceRoot, target)
    )
  }
  return false
}
