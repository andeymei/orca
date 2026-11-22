import path from 'node:path'
import { realpath, stat } from 'node:fs/promises'
import { isPathAbsentError } from '../ipc/filesystem/access/filesystem-path-containment'
import { readWorkspaceFile } from './refactor-file-reads'

/**
 * The key a file's inode answers to.
 *
 * Why the prefix: an absolute path never looks like this, so the two kinds of key cannot
 * be mistaken for one another.
 */
function inodeKey(dev: number, ino: number): string {
  return `inode:${dev}-${ino}`
}

/**
 * The keys a file answers to: the path it was named by, the path the filesystem calls it,
 * and the inode it is.
 *
 * Why all three: a path answers "is this the same name" and an inode answers "is this the
 * same file", and the two disagree in both directions. A hardlinked twin has another name
 * and the same inode; a file that was replaced under the user (an editor that saves by
 * renaming) has the same name and another inode; a case-insensitive volume spells one file
 * two ways, so the spelling is not the name either. Either kind of key alone loses one of
 * those cases, and losing it costs the user's unsaved edits.
 *
 * The path it was named by is the key that survives the file being gone: a file deleted
 * between the two moments still answers to the spelling it was asked for.
 *
 * `fs.promises.realpath` and not `realpathSync`: the synchronous one keeps the case it was
 * given, so the two spellings stay apart on a case-insensitive volume, while the
 * asynchronous one returns the canonical on-disk name and collapses them.
 */
export async function refactorFileKeys(
  workspaceRoot: string,
  relativePath: string
): Promise<string[]> {
  const resolved = path.resolve(workspaceRoot, relativePath)
  const keys = new Set<string>()
  keys.add(resolved)
  try {
    keys.add(await realpath(resolved))
  } catch (error) {
    // The path cannot be canonicalised: the file is not there, a directory of it cannot
    // be walked, or it is a symlink loop. The resolved path still names the file it would
    // be, and the disk read fails in the same conditions, so the proposal is dropped
    // rather than given the baseline of another file.
    if (!isPathAbsentError(error)) {
      console.warn('[refactor] could not canonicalise a workspace file:', error)
    }
  }
  try {
    const stats = await stat(resolved)
    // A zero inode names no file: it would make every file of the device answer to the
    // same key.
    if (stats.ino > 0) {
      keys.add(inodeKey(stats.dev, stats.ino))
    }
  } catch (error) {
    // The file has no inode yet: it is not there, or it cannot be read. The path keys
    // answer for it, and the disk read fails in the same conditions.
    if (!isPathAbsentError(error)) {
      console.warn('[refactor] could not read the identity of a workspace file:', error)
    }
  }
  return [...keys]
}

/**
 * The baseline map of a job: the user's buffer, keyed by the file it names.
 *
 * The buffer is stored under every key the file answers to, so a manifest that names the
 * same file differently still finds it, and a manifest that names another file does not.
 */
export async function refactorBaselineMap(input: {
  workspaceRoot: string
  relativePath: string
  content: string
}): Promise<Map<string, string>> {
  const keys = await refactorFileKeys(input.workspaceRoot, input.relativePath)
  const baselines = new Map<string, string>()
  for (const key of keys) {
    baselines.set(key, input.content)
  }
  return baselines
}

/** The baseline of a file: the buffer the user saw, when the file is the one the job is about. */
export async function refactorBaselineFor(
  baselines: ReadonlyMap<string, string>,
  workspaceRoot: string,
  relativePath: string
): Promise<string | undefined> {
  const keys = await refactorFileKeys(workspaceRoot, relativePath)
  for (const key of keys) {
    const baseline = baselines.get(key)
    if (baseline !== undefined) {
      return baseline
    }
  }
  return undefined
}

/**
 * The baseline of each file: the buffer the user saw for the target file, the disk for the rest.
 *
 * A file that is not there has no baseline and no disk content, so the plan drops it: the
 * spec does not accept new files.
 */
export function refactorBaselineReader(input: {
  baselines: ReadonlyMap<string, string>
  workspaceRoot: string
}): (relativePath: string) => Promise<string | null> {
  return async (relativePath) => {
    const baseline = await refactorBaselineFor(input.baselines, input.workspaceRoot, relativePath)
    if (baseline !== undefined) {
      return baseline
    }
    const read = await readWorkspaceFile(input.workspaceRoot, relativePath)
    return read.status === 'read' ? read.content : null
  }
}
