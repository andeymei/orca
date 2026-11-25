/** Index Quick Open candidates once per listing so repeated keystrokes score a cached form instead of
 * re-normalizing every path. */
import {
  asciiIdentifierBoundaries,
  unicodeIdentifierBoundaries
} from './quick-open-identifier-boundaries'

export type QuickOpenIndexedFile = {
  path: string
  lowerPath: string
  lowerFilename: string
  inputIndex: number
}

const NON_ASCII = /[^\u0080-\u{10ffff}]/u

const identifierBoundaries = new WeakMap<QuickOpenIndexedFile, ReadonlySet<number>>()

const preparedQuickOpenFiles = new WeakMap<readonly string[], QuickOpenIndexedFile[]>()

export function prepareQuickOpenFiles(files: readonly string[]): QuickOpenIndexedFile[] {
  return files.map((path, inputIndex) => prepareQuickOpenFile(path, inputIndex))
}

export function getPreparedQuickOpenFiles(
  files: readonly string[]
): readonly QuickOpenIndexedFile[] {
  const cached = preparedQuickOpenFiles.get(files)
  if (cached) {
    return cached
  }
  const prepared = prepareQuickOpenFiles(files)
  preparedQuickOpenFiles.set(files, prepared)
  return prepared
}

/** Identifier boundaries let a query's separators match their alternatives inside one identifier. */
export function getIdentifierBoundaries(
  file: QuickOpenIndexedFile
): ReadonlySet<number> | undefined {
  return identifierBoundaries.get(file)
}

export function prepareQuickOpenFile(path: string, inputIndex: number): QuickOpenIndexedFile {
  // Listings run this per path on every open; ASCII paths (nearly all) skip Unicode work.
  const ascii = !NON_ASCII.test(path)
  const slashed = path.includes('\\') ? path.replace(/\\/g, '/') : path
  const searchPath = ascii ? slashed : composeQuickOpenText(slashed)
  const lowerPath = ascii
    ? searchPath.toLowerCase()
    : composeQuickOpenText(searchPath.toLowerCase())
  // A folder ends in `/`; its name is the segment before it.
  const nameEnd = lowerPath.endsWith('/') ? lowerPath.length - 1 : lowerPath.length
  const file = {
    path,
    lowerPath,
    lowerFilename: lowerPath.slice(lowerPath.lastIndexOf('/', nameEnd - 1) + 1, nameEnd),
    inputIndex
  }
  if (/[A-Z]/.test(searchPath)) {
    const boundaries = ascii
      ? asciiIdentifierBoundaries(searchPath)
      : unicodeIdentifierBoundaries(searchPath)
    if (boundaries) {
      identifierBoundaries.set(file, boundaries)
    }
  }
  return file
}

/** macOS often stores names decomposed (NFD) while keyboards type composed (NFC). */
export function composeQuickOpenText(text: string): string {
  return NON_ASCII.test(text) ? text.normalize('NFC') : text
}
