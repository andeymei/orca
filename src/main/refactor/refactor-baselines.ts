import path from 'node:path'
import { realpath, stat } from 'node:fs/promises'
import { isPathAbsentError } from '../ipc/filesystem/access/filesystem-path-containment'
import { readWorkspaceFile } from './refactor-file-reads'

/** The prefix that tells an inode key from a path key. */
const INODE_KEY_PREFIX = 'inode:'

/**
 * The text a refactoring works from, and the witness that tells the target from its echo.
 *
 * Why a witness: an inode is not an identity of its own — the filesystem hands a freed inode
 * to the next file it creates. The witness is the file's content when the job started, and
 * only the file that still holds that content is the target.
 */
export type RefactorBaseline = {
  /** The editor buffer the user is looking at. */
  content: string
  /** The file's disk content when the job started; null when the file was not on the disk. */
  witness: string | null
}

/**
 * How the file's identity is read.
 *
 * Why it is a seam: a test has to force an inode collision to see the witness at work, and
 * no filesystem hands a freed inode over on demand.
 */
export type RefactorBaselineDeps = {
  /** The device and the inode the filesystem gives the file. */
  stat: (absolutePath: string) => Promise<{ dev: number; ino: number }>
}

const DEFAULT_DEPS: RefactorBaselineDeps = {
  stat: async (absolutePath) => stat(absolutePath)
}

/**
 * The key a file's inode answers to.
 *
 * Why the prefix: an absolute path never looks like this, so the two kinds of key cannot
 * be mistaken for one another.
 */
function inodeKey(dev: number, ino: number): string {
  return `${INODE_KEY_PREFIX}${dev}-${ino}`
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
 * The path it was named by is the key that survives the file being gone, as long as the
 * manifest spells it the same way: a file deleted between the two moments still answers to
 * the spelling it was asked for, and a different spelling misses and the proposal is dropped.
 *
 * The inode is last on purpose: a path that answers is the target without a witness, and
 * only the inode needs one.
 *
 * `fs.promises.realpath` and not `realpathSync`: the synchronous one keeps the case it was
 * given, so the two spellings stay apart on a case-insensitive volume, while the
 * asynchronous one returns the canonical on-disk name and collapses them.
 */
export async function refactorFileKeys(
  workspaceRoot: string,
  relativePath: string,
  deps: RefactorBaselineDeps = DEFAULT_DEPS
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
    const identity = await deps.stat(resolved)
    // A zero inode names no file: it would make every file of the device answer to the
    // same key.
    if (identity.ino > 0) {
      keys.add(inodeKey(identity.dev, identity.ino))
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

/** The file's content on the disk at this moment: the witness of the target's identity. */
async function refactorDiskWitness(
  workspaceRoot: string,
  relativePath: string
): Promise<string | null> {
  const read = await readWorkspaceFile(workspaceRoot, relativePath)
  return read.status === 'read' ? read.content : null
}

/**
 * Whether the file still holds the content the target held when the job started.
 *
 * Why the content and not the inode: the inode is handed to the next file the filesystem
 * creates, and the content is not. A hardlinked twin holds the same content, so the twin is
 * still the target; a file that took the freed inode holds its own content, so it is not.
 */
async function refactorWitnessMatches(
  baseline: RefactorBaseline,
  workspaceRoot: string,
  relativePath: string
): Promise<boolean> {
  if (baseline.witness === null) {
    return false
  }
  const read = await readWorkspaceFile(workspaceRoot, relativePath)
  return read.status === 'read' && read.content === baseline.witness
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
  deps?: RefactorBaselineDeps
}): Promise<Map<string, RefactorBaseline>> {
  const deps = input.deps ?? DEFAULT_DEPS
  const keys = await refactorFileKeys(input.workspaceRoot, input.relativePath, deps)
  const baseline: RefactorBaseline = {
    content: input.content,
    witness: await refactorDiskWitness(input.workspaceRoot, input.relativePath)
  }
  const baselines = new Map<string, RefactorBaseline>()
  for (const key of keys) {
    baselines.set(key, baseline)
  }
  return baselines
}

/** The baseline of a file: the buffer the user saw, when the file is the one the job is about. */
export async function refactorBaselineFor(
  baselines: ReadonlyMap<string, RefactorBaseline>,
  workspaceRoot: string,
  relativePath: string,
  deps: RefactorBaselineDeps = DEFAULT_DEPS
): Promise<string | undefined> {
  const keys = await refactorFileKeys(workspaceRoot, relativePath, deps)
  for (const key of keys) {
    const baseline = baselines.get(key)
    if (baseline === undefined) {
      continue
    }
    if (
      key.startsWith(INODE_KEY_PREFIX) &&
      !(await refactorWitnessMatches(baseline, workspaceRoot, relativePath))
    ) {
      // The inode answers, but the content does not: this is another file that took the
      // freed inode, and the buffer is not its baseline.
      continue
    }
    return baseline.content
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
  baselines: ReadonlyMap<string, RefactorBaseline>
  workspaceRoot: string
  deps?: RefactorBaselineDeps
}): (relativePath: string) => Promise<string | null> {
  const deps = input.deps ?? DEFAULT_DEPS
  return async (relativePath) => {
    const baseline = await refactorBaselineFor(
      input.baselines,
      input.workspaceRoot,
      relativePath,
      deps
    )
    if (baseline !== undefined) {
      return baseline
    }
    const read = await readWorkspaceFile(input.workspaceRoot, relativePath)
    return read.status === 'read' ? read.content : null
  }
}
