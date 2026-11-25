// The capability directories under a project's `openspec/specs/`.
//
// The board needs them to say whether an archived change ever reached the specs. A remote
// project cannot be read from here, so its list is absent: absent means unknown, and an empty
// list would claim the project has no capabilities at all — which would report every archived
// capability of every remote project as stale.

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const OPENSPEC_SPECS = join('openspec', 'specs')

/**
 * The capability names of a local project, or undefined when the listing cannot be made. A
 * directory that is not there is an empty list — the project really has no capabilities — while
 * a directory that is there but out of reach is unknown.
 */
export async function readSpecCapabilities(root: string): Promise<string[] | undefined> {
  try {
    const entries = await readdir(join(root, OPENSPEC_SPECS), { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return []
    }
    return undefined
  }
}
