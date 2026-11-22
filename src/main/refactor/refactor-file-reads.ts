import { readdir } from 'node:fs/promises'
import path from 'node:path'
import {
  NodeFileNotRegularError,
  NodeFileReadTooLargeError,
  readNodeFileWithinLimit
} from '../../shared/file-content/node-bounded-file-reader'
import { isENOENT } from '../ipc/filesystem/access/filesystem-path-containment'
import { isPathInsideScratch } from './refactor-write-gate'

/** The agent's own output is untrusted input: an unbounded read lets it exhaust the main process. */
const SCRATCH_FILE_MAX_BYTES = 2 * 1024 * 1024

/** The workspace files the plan compares against; the same cap the runtime's text reads use. */
const WORKSPACE_FILE_MAX_BYTES = 2 * 1024 * 1024

/**
 * What a read of a workspace file produced.
 *
 * Why the three cases: a file that is gone and a file that cannot be read need different words,
 * and telling the user a 3 MB file was deleted is a lie.
 */
export type RefactorFileReadResult =
  | { status: 'read'; content: string }
  | { status: 'missing' }
  | { status: 'unreadable'; reason: string }

/** Why the file could not be read, in the words the user reads. */
function unreadableReason(error: unknown): string {
  if (error instanceof NodeFileReadTooLargeError) {
    return '文件过大，无法安全读取'
  }
  if (error instanceof NodeFileNotRegularError) {
    return '文件不是普通文件，无法安全读取'
  }
  // The raw message is an errno with a path in it; it is not something to show a person.
  return '文件无法读取'
}

/** A workspace file's current disk content, or why it could not be read. */
export async function readWorkspaceFile(
  workspaceRoot: string,
  relativePath: string
): Promise<RefactorFileReadResult> {
  try {
    const read = await readNodeFileWithinLimit(
      path.join(workspaceRoot, relativePath),
      WORKSPACE_FILE_MAX_BYTES,
      { regularFileOnly: true }
    )
    return { status: 'read', content: read.buffer.toString('utf8') }
  } catch (error) {
    if (isENOENT(error)) {
      return { status: 'missing' }
    }
    return { status: 'unreadable', reason: unreadableReason(error) }
  }
}

/**
 * Whether a path is strictly inside a directory.
 *
 * Why not the scratch gate: that one answers "inside the scratch root", and a proposal's file
 * list is relative to the proposal's own directory, so a path of `../` would still be inside
 * the scratch root while naming another proposal's file.
 */
function isInsideDirectory(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

/**
 * Reads one file of one proposal.
 *
 * The proposal id comes from the agent's manifest, so the joined path is checked against the
 * scratch root before it is opened: an id of `..` would otherwise read outside the tree.
 */
export async function readScratchFile(
  scratchRoot: string,
  proposalId: string,
  relativePath: string
): Promise<string | null> {
  const proposalRoot = path.resolve(scratchRoot, proposalId)
  const filePath = path.resolve(proposalRoot, relativePath)
  if (!isPathInsideScratch(scratchRoot, filePath)) {
    return null
  }
  if (!isInsideDirectory(proposalRoot, filePath)) {
    return null
  }
  try {
    const read = await readNodeFileWithinLimit(filePath, SCRATCH_FILE_MAX_BYTES, {
      regularFileOnly: true
    })
    return read.buffer.toString('utf8')
  } catch {
    return null
  }
}

/** The files of one proposal directory, relative to that directory. */
async function listProposalFiles(root: string, prefix = ''): Promise<string[]> {
  let entries
  try {
    entries = await readdir(prefix ? path.join(root, prefix) : root, { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...(await listProposalFiles(root, relative)))
      continue
    }
    files.push(relative)
  }
  return files
}

/**
 * The proposal directories of the scratch tree, each with the files it holds.
 *
 * A file path is relative to its proposal directory, so it is the workspace-relative path the
 * plan uses: `<scratchRoot>/p1/src/foo.ts` is reported as `src/foo.ts`.
 */
export async function listScratchProposals(
  scratchRoot: string
): Promise<{ id: string; files: string[] }[]> {
  let entries
  try {
    entries = await readdir(scratchRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const proposals: { id: string; files: string[] }[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }
    proposals.push({
      id: entry.name,
      files: await listProposalFiles(path.join(scratchRoot, entry.name))
    })
  }
  return proposals
}
