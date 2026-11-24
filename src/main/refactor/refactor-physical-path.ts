import path from 'node:path'
import { realpath } from 'node:fs/promises'
import { isDefinitiveAbsence } from '../../shared/errors/definitive-filesystem-absence'

/** Windows takes both separators; the other platforms take one. */
const SEPARATOR_PATTERN = process.platform === 'win32' ? /[\\/]/ : /\//

/** The root of a path and the components below it, with every `..` left as it was spelled. */
export type PhysicalPathParts = {
  root: string
  components: string[]
}

/**
 * Why the split is by hand: `path.parse` is the only path function that leaves the components
 * as they were written, and the `..` in them is the whole point.
 */
export function splitPhysicalPath(rawPath: string): PhysicalPathParts {
  const parsed = path.parse(rawPath)
  const below = parsed.dir.slice(parsed.root.length)
  const components = below.split(SEPARATOR_PATTERN).filter((part) => part.length > 0)
  if (parsed.base.length > 0) {
    components.push(parsed.base)
  }
  return { root: parsed.root, components }
}

/**
 * The location a path really has.
 *
 * Why the path is walked in runs: one `realpath` cannot answer for a path whose tail does not
 * exist yet -- it fails with ENOENT -- so the path is resolved in runs, and a run that holds no
 * `..` is resolved with the OS's own resolver. Why the `..` between the runs is applied here:
 * the kernel follows a symbolic link before it applies the `..` that follows it, so
 * `/ws/link/../secret` lands in `/secret` when `link` points at `/etc`; the `..` has to be
 * applied to the directory the run really ended in.
 *
 * Why a path that is not there still gets an answer: a write names a file that does not exist
 * yet, and the kernel puts it where the part of the path that does exist says.
 *
 * Why null: the caller denies every path it cannot resolve.
 */
export async function resolvePhysicalPath(targetPath: string): Promise<string | null> {
  if (!path.isAbsolute(targetPath)) {
    return null
  }
  const { root, components } = splitPhysicalPath(targetPath)
  let current = root
  let index = 0
  while (index < components.length) {
    if (components[index] === '..') {
      // The kernel applies `..` to the directory it is in, which is the resolved one.
      current = path.dirname(current)
      index += 1
      continue
    }
    const run: string[] = []
    while (index < components.length && components[index] !== '..') {
      run.push(components[index])
      index += 1
    }
    const resolved = await resolveRun(current, run)
    if (resolved === null) {
      return null
    }
    current = resolved
  }
  return current
}

/**
 * The physical path of a run of components that holds no `..`.
 *
 * Why the OS's own resolver: it follows the links in the run and spells it the way the disk
 * does. Why the shorter runs: the run may name a file that is not there yet, and the part of
 * it that is decides where the rest of it lands.
 */
async function resolveRun(current: string, run: string[]): Promise<string | null> {
  if (run.length === 0) {
    return current
  }
  try {
    return await realpath(path.join(current, ...run))
  } catch (error) {
    if (!isDefinitiveAbsence(error)) {
      return null
    }
  }
  for (let length = run.length - 1; length > 0; length -= 1) {
    try {
      const prefix = await realpath(path.join(current, ...run.slice(0, length)))
      return path.join(prefix, ...run.slice(length))
    } catch (error) {
      if (!isDefinitiveAbsence(error)) {
        return null
      }
    }
  }
  return path.join(current, ...run)
}
