// Verifies that a packaged app.asar's data section matches the sizes and hashes its header
// records.
//
// The header is generated from the files on disk, but the data section is written separately.
// A file that grows while the archive is written shifts the data section off the recorded
// offsets; Electron's integrity check then rejects the main bundle and the app exits 1 before
// it logs anything.

const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')

function readAsarHeader(buffer) {
  const headerSize = buffer.readUInt32LE(4)
  const headerStringSize = buffer.readUInt32LE(12)
  return {
    header: JSON.parse(buffer.toString('utf8', 16, 16 + headerStringSize)),
    dataStart: 8 + headerSize
  }
}

function collectPackedFiles(node, path, files) {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const entryPath = `${path}/${name}`
    if (entry.files) {
      collectPackedFiles(entry, entryPath, files)
    } else if (entry.offset !== undefined && !entry.unpacked) {
      files.push({
        path: entryPath,
        offset: Number(entry.offset),
        size: entry.size,
        hash: entry.integrity?.hash
      })
    }
  }
  return files
}

function verifyPackagedAsarIntegrity(asarPath, archiveBuffer) {
  const buffer = archiveBuffer ?? readFileSync(asarPath)
  const { header, dataStart } = readAsarHeader(buffer)
  const packedFiles = collectPackedFiles(header, '', [])
  const mismatches = []
  for (const file of packedFiles) {
    const start = dataStart + file.offset
    const end = start + file.size
    if (end > buffer.length) {
      mismatches.push(`${file.path} (recorded ${file.size} bytes past the end of the archive)`)
      continue
    }
    if (!file.hash) {
      continue
    }
    const actual = createHash('sha256').update(buffer.subarray(start, end)).digest('hex')
    if (actual !== file.hash) {
      mismatches.push(file.path)
    }
  }
  if (mismatches.length > 0) {
    throw new Error(
      `Packaged asar ${asarPath} does not match its header: ${mismatches.length} packed file(s) differ (first: ${mismatches[0]}). ` +
        'A file that changed size while the archive was written shifts the data section off the recorded offsets, and the app then exits before the main bundle loads.'
    )
  }
  return { checked: packedFiles.length }
}

module.exports = { verifyPackagedAsarIntegrity }
