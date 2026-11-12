import { realpath } from 'node:fs/promises'
import { normalizeRuntimePathForComparison } from '../../../shared/cross-platform-path'

async function realpathKey(path: string): Promise<string | null> {
  try {
    return normalizeRuntimePathForComparison(await realpath(path))
  } catch {
    return null
  }
}

/**
 * Compare two paths that may name the same checkout through different strings.
 *
 * Git reports a repository's root as its realpath, so a path that traverses a symlink names the
 * same checkout under a different string than the one stored for it.
 */
export async function pathMatchesAtSameRealPath(left: string, right: string): Promise<boolean> {
  if (normalizeRuntimePathForComparison(left) === normalizeRuntimePathForComparison(right)) {
    return true
  }
  const [leftReal, rightReal] = await Promise.all([realpathKey(left), realpathKey(right)])
  return leftReal !== null && rightReal !== null && leftReal === rightReal
}

/** Resolve symlink aliases so the same checkout cannot be registered twice. */
export async function findProjectAtSameRealPath<T extends { path: string }>(
  projects: readonly T[],
  path: string
): Promise<T | null> {
  if (projects.length === 0) {
    return null
  }
  const target = await realpathKey(path)
  if (!target) {
    return null
  }
  const keys = await Promise.all(projects.map((project) => realpathKey(project.path)))
  const index = keys.indexOf(target)
  return index === -1 ? null : projects[index]
}
