import path from 'node:path'
import { realpath } from 'node:fs/promises'
import { readWorkspaceFile } from './refactor-file-reads'

/**
 * The identity of a file: the path the filesystem itself calls it.
 *
 * Why not a string key: `src/Foo.ts` and `src/foo.ts` are one file on macOS and Windows and two
 * files on Linux, and only the filesystem knows which. `fs.promises.realpath` and not
 * `realpathSync`: the synchronous one keeps the case it was given, so the two spellings stay
 * apart on a case-insensitive volume, while the asynchronous one returns the canonical on-disk
 * name and collapses them.
 */
export async function refactorFileIdentity(
  workspaceRoot: string,
  relativePath: string
): Promise<string> {
  const resolved = path.resolve(workspaceRoot, relativePath)
  try {
    return await realpath(resolved)
  } catch {
    // The file is not there; the resolved path still names the file it would be.
    return resolved
  }
}

/**
 * The baseline map of a job: the user's buffer, keyed by the file it names.
 *
 * The key is the file's identity, so a manifest that spells the path differently still finds
 * the buffer when it names the same file, and a manifest that names another file does not.
 */
export async function refactorBaselineMap(input: {
  workspaceRoot: string
  relativePath: string
  content: string
}): Promise<Map<string, string>> {
  const identity = await refactorFileIdentity(input.workspaceRoot, input.relativePath)
  return new Map([[identity, input.content]])
}

/** The baseline of a file: the buffer the user saw, when the file is the one the job is about. */
export async function refactorBaselineFor(
  baselines: ReadonlyMap<string, string>,
  workspaceRoot: string,
  relativePath: string
): Promise<string | undefined> {
  const identity = await refactorFileIdentity(workspaceRoot, relativePath)
  return baselines.get(identity)
}

/**
 * The baseline of each file: the buffer the user saw for the target file, the disk for the rest.
 *
 * A file that is not there has no identity and no baseline, and its disk read fails too, so the
 * plan drops it: the spec does not accept new files.
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
