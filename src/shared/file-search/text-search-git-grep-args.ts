/** git-grep argument construction, kept apart from the ripgrep path so the two search engines stay
 * independently readable while sharing one glob policy. */
import { splitSearchGlobPatterns, toGitGlobPathspecs } from './text-search-glob-patterns'

export type GitGrepOptions = {
  caseSensitive?: boolean
  wholeWord?: boolean
  useRegex?: boolean
  includePattern?: string
  excludePattern?: string
}

export function buildGitGrepArgs(query: string, opts: GitGrepOptions): string[] {
  // Disable submodule recursion to avoid its conflict with --untracked; NUL delimiters disambiguate colons in filenames.
  const gitArgs: string[] = [
    '-c',
    'submodule.recurse=false',
    '-c',
    'grep.column=false',
    'grep',
    '-n',
    '-I',
    '--null',
    '--no-color',
    '--untracked',
    '--no-recurse-submodules'
  ]
  if (!opts.caseSensitive) {
    gitArgs.push('-i')
  }
  if (opts.wholeWord) {
    gitArgs.push('-w')
  }
  if (!opts.useRegex) {
    gitArgs.push('--fixed-strings')
  } else {
    gitArgs.push('--extended-regexp')
  }

  gitArgs.push('-e', query, '--')

  let hasPathspecs = false
  let hasIncludePathspecs = false
  if (opts.includePattern) {
    for (const pat of splitSearchGlobPatterns(opts.includePattern, 'git')) {
      const pathspecs = toGitGlobPathspecs(pat)
      gitArgs.push(...pathspecs)
      hasPathspecs ||= pathspecs.length > 0
      hasIncludePathspecs ||= pathspecs.length > 0
    }
  }
  if (opts.excludePattern) {
    for (const pat of splitSearchGlobPatterns(opts.excludePattern, 'git')) {
      const pathspecs = toGitGlobPathspecs(pat, true)
      gitArgs.push(...pathspecs)
      hasPathspecs ||= pathspecs.length > 0
    }
  }
  // Why: git grep needs a pathspec to search the working tree; '.' means everything under cwd.
  if (opts.includePattern && !hasIncludePathspecs) {
    gitArgs.push(':(top,literal).git')
  } else if (!hasPathspecs) {
    gitArgs.push('.')
  }
  return gitArgs
}
