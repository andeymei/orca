/** The key of one open file's instructions; the NUL separator keeps ids containing it apart. */
export function aiInstructionFileKey(worktreeId: string, relativePath: string): string {
  return `${worktreeId}\u0000${relativePath}`
}
