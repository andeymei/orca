import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { verifyPackagedAsarIntegrity } = require('./packaged-asar-integrity.cjs')

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function align4(size) {
  return (size + 3) & ~3
}

/** Builds an asar whose header records the given sizes and hashes over the given data section. */
function buildAsar(entries, dataSection) {
  const header = { files: {} }
  for (const entry of entries) {
    const parts = entry.path.split('/')
    let node = header.files
    for (const part of parts.slice(0, -1)) {
      node = (node[part] ??= { files: {} }).files
    }
    node[parts.at(-1)] = {
      size: entry.size,
      offset: String(entry.offset),
      integrity: {
        algorithm: 'SHA256',
        hash: entry.hash,
        blockSize: 4194304,
        blocks: [entry.hash]
      }
    }
  }
  const headerJson = Buffer.from(JSON.stringify(header))
  const padded = align4(headerJson.length)
  const payload = Buffer.alloc(4 + padded)
  payload.writeUInt32LE(headerJson.length, 0)
  headerJson.copy(payload, 4)
  const headerSize = 8 + padded
  const sizeBuf = Buffer.alloc(8)
  sizeBuf.writeUInt32LE(4, 0)
  sizeBuf.writeUInt32LE(headerSize, 4)
  const headerBuf = Buffer.alloc(4 + payload.length)
  headerBuf.writeUInt32LE(payload.length, 0)
  payload.copy(headerBuf, 4)
  return Buffer.concat([sizeBuf, headerBuf, dataSection])
}

describe('verifyPackagedAsarIntegrity', () => {
  it('accepts an archive whose data section matches its header', () => {
    const first = Buffer.from('AAAA')
    const second = Buffer.from('BBBBBBBB')
    const archive = buildAsar(
      [
        { path: '/out/main/index.js', size: first.length, offset: 0, hash: sha256(first) },
        {
          path: '/out/preload/index.js',
          size: second.length,
          offset: first.length,
          hash: sha256(second)
        }
      ],
      Buffer.concat([first, second])
    )
    expect(verifyPackagedAsarIntegrity('/tmp/archive.asar', archive)).toEqual({ checked: 2 })
  })

  it('rejects an archive whose data section shifted off the recorded offsets', () => {
    // The file grew while the archive was written: the header still records the old size and
    // the old offsets, so every later file now reads bytes that belong to another file.
    const grown = Buffer.from('AAAAAAAA')
    const second = Buffer.from('BBBBBBBB')
    const archive = buildAsar(
      [
        { path: '/out/main/index.js', size: 4, offset: 0, hash: sha256(Buffer.from('AAAA')) },
        {
          path: '/out/preload/index.js',
          size: second.length,
          offset: 4,
          hash: sha256(second)
        }
      ],
      Buffer.concat([grown, second])
    )
    expect(() => verifyPackagedAsarIntegrity('/tmp/archive.asar', archive)).toThrow(
      /does not match its header[\s\S]*\/out\/preload\/index\.js/
    )
  })
})
