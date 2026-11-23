import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** The main-process files that carry the feature's copy. */
const SOURCE_FILES = ['./refactor-messages.ts', './refactor-plan-messages.ts']

const EN_CATALOG = new URL('../../renderer/src/i18n/locales/en.json', import.meta.url)
const ZH_CATALOG = new URL('../../renderer/src/i18n/locales/zh.json', import.meta.url)

type Catalog = { [key: string]: string | Catalog }

/** The message every key of the feature carries, as the source writes it. */
const CALL = /translateMain\(\s*'([\w.]+)'\s*,\s*'([^']*)'/g

function readCatalog(url: URL): Catalog {
  return JSON.parse(readFileSync(url, 'utf8'))
}

/** The catalog entry a dotted key names, or undefined when the catalog has none. */
function catalogEntry(catalog: Catalog, key: string): string | undefined {
  let cursor: string | Catalog = catalog
  for (const part of key.split('.')) {
    if (typeof cursor === 'string') {
      return undefined
    }
    const next = cursor[part]
    if (next === undefined) {
      return undefined
    }
    cursor = next
  }
  return typeof cursor === 'string' ? cursor : undefined
}

/** Every key the catalogs declare under the feature's namespace. */
function featureKeys(catalog: Catalog): string[] {
  const feature = catalog.refactor
  if (feature === undefined || typeof feature === 'string') {
    return []
  }
  const keys: string[] = []
  const walk = (node: Catalog, prefix: string): void => {
    for (const [name, value] of Object.entries(node)) {
      const key = `${prefix}.${name}`
      if (typeof value === 'string') {
        keys.push(key)
        continue
      }
      walk(value, key)
    }
  }
  walk(feature, 'refactor')
  return keys.sort()
}

/** The English fallback every main-process message carries, read out of the source. */
function sourceMessages(): { key: string; english: string }[] {
  const messages: { key: string; english: string }[] = []
  for (const file of SOURCE_FILES) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    for (const match of source.matchAll(CALL)) {
      messages.push({ key: match[1], english: match[2] })
    }
  }
  return messages
}

/** How many times the source asks for a translation; a pattern that stopped matching would hide it. */
function translationCallCount(): number {
  let count = 0
  for (const file of SOURCE_FILES) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    count += source.split('translateMain(').length - 1
  }
  return count
}

describe('the main-process copy of the refactoring feature', () => {
  it('writes every message with an English fallback that en.json holds', () => {
    const messages = sourceMessages()
    expect(messages.length).toBe(translationCallCount())
    const english = readCatalog(EN_CATALOG)
    for (const message of messages) {
      expect(catalogEntry(english, message.key)).toBe(message.english)
    }
  })

  it('declares every message in the English catalog, and nothing else', () => {
    const english = readCatalog(EN_CATALOG)
    const declared = featureKeys(english)
    expect(declared.length).toBeGreaterThan(0)
    const written = [...new Set(sourceMessages().map((message) => message.key))].sort()
    expect(declared).toEqual(written)
  })

  it('gives every message a Chinese translation in zh.json', () => {
    const chinese = readCatalog(ZH_CATALOG)
    const keys = [...new Set(sourceMessages().map((message) => message.key))].sort()
    // Why the count: a scan that found nothing would make the loop below vacuous.
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      const value = catalogEntry(chinese, key)
      expect(value).toBeDefined()
      expect(value).toMatch(/[一-鿿]/)
    }
  })
})
