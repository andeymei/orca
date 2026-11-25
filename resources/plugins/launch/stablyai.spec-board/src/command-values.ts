// The gate every project-derived value passes before it can reach a command line or an agent
// prompt. The values are read out of a repository the user may have cloned — a change id is a
// directory name, an artifact path is a file path — so they can carry a shell command or a
// prompt injection. The rule keeps only characters that carry no meaning to a shell, and the
// first character must be alphanumeric, so a value can never be read as an option either.

/** Alphanumerics, dot, dash and underscore; the first character must be alphanumeric. */
const SAFE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Whether a value may be put in front of a command or into an agent prompt. */
export function isSafeCommandValue(value: string): boolean {
  return SAFE_VALUE.test(value)
}

/**
 * Whether a path may be put in front of a command or into an agent prompt. The path is split
 * on `/`, empty segments are skipped so an absolute path is fine, and every other segment has
 * to be a safe value on its own — which rejects `..` along with everything carrying a shell
 * character.
 */
export function isSafeCommandPath(path: string): boolean {
  return path.split('/').every((segment) => segment === '' || isSafeCommandValue(segment))
}
