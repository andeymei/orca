import { readWorkspaceFile } from './refactor-file-reads'
import { refactorBaselineKey } from './refactor-path-rules'

/** The baseline map of a job, keyed the way the plan keys its paths. */
export function refactorBaselineMap(relativePath: string, content: string): Map<string, string> {
  return new Map([[refactorBaselineKey(relativePath), content]])
}

/**
 * The baseline of a file: the buffer the user saw.
 *
 * The map is keyed the way the plan keys its paths, so a manifest that spells the path with
 * another separator still finds the buffer instead of the disk.
 */
export function refactorBaselineFor(
  baselines: ReadonlyMap<string, string>,
  relativePath: string
): string | undefined {
  return baselines.get(refactorBaselineKey(relativePath))
}

/**
 * The baseline of each file: the buffer the user saw for the target file, the disk for the rest.
 */
export function refactorBaselineReader(input: {
  baselines: ReadonlyMap<string, string>
  workspaceRoot: string
}): (relativePath: string) => Promise<string | null> {
  return async (relativePath) => {
    const baseline = refactorBaselineFor(input.baselines, relativePath)
    if (baseline !== undefined) {
      return baseline
    }
    const read = await readWorkspaceFile(input.workspaceRoot, relativePath)
    return read.status === 'read' ? read.content : null
  }
}
