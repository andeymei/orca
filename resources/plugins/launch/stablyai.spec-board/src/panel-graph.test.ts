// The panel runs in a frame: no file system, no network, and no bundler.
//
// A module the panel pulls in that reaches for `node:fs` fails to load — the frame's policy
// blocks it — and the panel goes blank with nothing but a frame error to say so. The same goes
// for an import that names no file of the plugin: the frame has no resolver to fall back on.
// This test walks the panel's own import graph and says so here, where the answer is a name.
import { assert, test } from 'orca/testing'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The frame's own resolution order, so this test resolves what the frame resolves. */
const EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mts', '.mjs']

// Why not `import.meta.dirname`: the plugin's own test runner transpiles this file, and there
// that is the directory of the transpiled copy, not the one this file was written in.
// oxlint-disable-next-line unicorn/prefer-import-meta-properties -- the runner's directory is wrong here
const SRC = fileURLToPath(new URL('.', import.meta.url))

/** One import of a module: the specifier, and whether it is a type-only one. */
type Import = { specifier: string; typeOnly: boolean }

/** The imports of a file, without its type-only ones — those are erased before the frame sees them. */
function importsOf(source: string): Import[] {
  const found: Import[] = []
  // An import can span lines, so the source is read as one piece.
  const pattern = /\bimport\s+(type\s+)?([^;]*?)\s+from\s+['"]([^'"]+)['"]/gs
  for (const match of source.matchAll(pattern)) {
    const names = (match[2] ?? '').trim()
    found.push({
      specifier: match[3] ?? '',
      typeOnly: (match[1] ?? '').trim() === 'type' || names === 'type'
    })
  }
  return found
}

/** The file a relative specifier names, the way the frame looks for it. */
function resolveSpecifier(from: string, specifier: string): string | null {
  const target = resolve(dirname(from), specifier)
  for (const extension of EXTENSIONS) {
    if (exists(`${target}${extension}`)) {
      return `${target}${extension}`
    }
  }
  for (const extension of EXTENSIONS) {
    if (exists(join(target, `index${extension}`))) {
      return join(target, `index${extension}`)
    }
  }
  return null
}

function exists(path: string): boolean {
  return existsSync(path)
}

/** The runtime import graph of the panel's entry: the files it loads, and what it may not load. */
async function panelGraph(entry: string): Promise<{ files: string[]; nodeImports: string[] }> {
  const seen = new Set<string>()
  const nodeImports: string[] = []
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.shift()!
    if (seen.has(file)) {
      continue
    }
    seen.add(file)
    const source = await readFile(file, 'utf8')
    for (const entry of importsOf(source)) {
      if (entry.typeOnly) {
        continue
      }
      if (entry.specifier.startsWith('node:')) {
        nodeImports.push(`${file}: ${entry.specifier}`)
        continue
      }
      if (entry.specifier === 'orca' || entry.specifier.startsWith('orca/')) {
        continue
      }
      if (!entry.specifier.startsWith('.')) {
        nodeImports.push(`${file}: ${entry.specifier} (a bare name; the frame has no bundler)`)
        continue
      }
      const resolved = resolveSpecifier(file, entry.specifier)
      if (resolved === null) {
        nodeImports.push(`${file}: ${entry.specifier} (no such file of the plugin)`)
        continue
      }
      queue.push(resolved)
    }
  }
  return { files: [...seen], nodeImports }
}

test('the panel loads nothing the frame cannot give it', async () => {
  const { files, nodeImports } = await panelGraph(join(SRC, 'panel.tsx'))
  assert.ok(files.length > 1)
  // Every import of the panel has to be a file of the plugin, and none of them may reach for the
  // file system: the frame has none, and a module that did would take the whole panel down.
  assert.deepEqual(nodeImports, [])
})
