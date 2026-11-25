/** Tracks paths already offered to a ranker so two scans over the same tree do not double-count. */
export class QuickOpenSeenPaths {
  private readonly paths = new Set<string>()

  /** Returns false when the path was already seen. */
  admit(path: string): boolean {
    if (this.paths.has(path)) {
      return false
    }
    this.paths.add(path)
    return true
  }
}
