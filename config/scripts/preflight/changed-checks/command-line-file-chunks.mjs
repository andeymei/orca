// Windows caps a command line near 32K characters; ARG_MAX caps it everywhere else. An upstream
// merge touches tens of thousands of files, so a long path list goes over in batches instead.
export const WINDOWS_COMMAND_LINE_CHARS = 24_000
export const POSIX_COMMAND_LINE_CHARS = 200_000

export function commandLineCharLimit(platform = process.platform) {
  return platform === 'win32' ? WINDOWS_COMMAND_LINE_CHARS : POSIX_COMMAND_LINE_CHARS
}

export function fitsCommandLine(files, maxChars) {
  return files.reduce((total, file) => total + file.length + 1, 0) <= maxChars
}

export function chunkForCommandLine(files, maxChars) {
  const chunks = [[]]
  let length = 0
  for (const file of files) {
    if (length + file.length + 1 > maxChars && chunks.at(-1).length > 0) {
      chunks.push([])
      length = 0
    }
    chunks.at(-1).push(file)
    length += file.length + 1
  }
  return chunks
}
