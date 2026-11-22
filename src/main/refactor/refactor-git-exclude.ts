import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { gitExecFileAsync } from '../git/command-runner/git-exec-file'

const REFACTOR_EXCLUDE_ENTRY = '.orca/refactor/'

/**
 * Keeps the scratch tree out of the repository's status.
 *
 * `info/exclude` belongs to the common git dir, which only git knows for a linked worktree; the
 * worktree's own `.git` is a file there, so the path is asked for instead of guessed.
 */
export async function excludeRefactorScratchFromGit(workspaceRoot: string): Promise<void> {
  try {
    const { stdout } = await gitExecFileAsync(['rev-parse', '--git-path', 'info/exclude'], {
      cwd: workspaceRoot
    })
    const excludePath = path.resolve(workspaceRoot, stdout.trim())
    let existing = ''
    try {
      existing = await readFile(excludePath, 'utf8')
    } catch {
      existing = ''
    }
    const lines = existing.split(/\r?\n/).map((line) => line.trim())
    if (lines.includes(REFACTOR_EXCLUDE_ENTRY)) {
      return
    }
    const head = existing.length > 0 && !existing.endsWith('\n') ? `${existing}\n` : existing
    await writeFile(excludePath, `${head}${REFACTOR_EXCLUDE_ENTRY}\n`, 'utf8')
  } catch {
    // A folder workspace is not a git repository; the scratch tree only shows up as untracked
    // files, which is a smaller problem than a request the user cannot make.
  }
}
