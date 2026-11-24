import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AI_VAULT_AGENTS,
  AI_VAULT_AGENT_LABELS
} from '../../../../shared/ai-vault/contracts/ai-vault-types'
import { AI_VAULT_AGENT_SOURCES } from '../../discovery/session-scanner-agent-sources'
import { parseQoderSessionFile } from './session-scanner-qoder-parser'

describe('Qoder China build rows', () => {
  it('is a known History agent with its own label', () => {
    expect(AI_VAULT_AGENTS).toContain('qoder-cn')
    expect(AI_VAULT_AGENT_LABELS['qoder-cn']).toBe('Qoder CLI China')
  })

  it("scans the China build's own projects directory", () => {
    const source = AI_VAULT_AGENT_SOURCES['qoder-cn']
    expect(source).toBeDefined()
    const roots = source?.rootDirs?.({}, [])
    expect(roots?.some((root) => root.endsWith(join('.qoder-cn', 'projects')))).toBe(true)
  })

  it('labels a parsed China row as qoder-cn', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qoder-cn-rows-'))
    try {
      const file = join(dir, 'qoder-session.jsonl')
      await writeFile(
        file,
        [
          JSON.stringify({ type: 'workspace-directories', directories: ['/tmp/qoder'] }),
          JSON.stringify({
            type: 'user',
            message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
            timestamp: '2026-11-17T00:00:00.000Z'
          })
        ].join('\n'),
        'utf8'
      )
      const session = await parseQoderSessionFile(
        { path: file, mtimeMs: 0, modifiedAt: '2026-11-17T00:00:00.000Z' },
        'linux',
        undefined,
        'qoder-cn'
      )
      expect(session?.agent).toBe('qoder-cn')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
