import { describe, expect, it } from 'vitest'
import {
  buildClaudeSessionStartupForUnknownHost,
  claudeAttachAgentId
} from './ai-vault-session-startup-for-lookup'

const SESSION_ID = '84693fdb-e203-4b59-81b1-ce59940554aa'

describe('buildClaudeSessionStartupForUnknownHost', () => {
  it('asks the host and keeps the resume command as the fallback', () => {
    const startup = buildClaudeSessionStartupForUnknownHost({
      sessionId: SESSION_ID,
      platform: 'linux',
      resumeStartup: { command: "cd '/srv/app' && claude --resume 'other'", cwd: '/srv/app' }
    })
    expect(startup.command).toContain('claude agents --json')
    expect(startup.command).toContain(`claude attach '${SESSION_ID.slice(0, 8)}'`)
    expect(startup.command).toContain(`else cd '/srv/app' && claude --resume 'other'; fi`)
    expect(startup.cwd).toBe('/srv/app')
  })

  it('asks a Windows host in PowerShell', () => {
    const startup = buildClaudeSessionStartupForUnknownHost({
      sessionId: SESSION_ID,
      platform: 'win32',
      shell: 'powershell',
      resumeStartup: { command: "Set-Location -LiteralPath 'D:\\app' ; claude --resume 'other'" }
    })
    expect(startup.command).toContain('Out-String')
    expect(startup.command).toContain(`{ claude attach '${SESSION_ID.slice(0, 8)}' }`)
  })
})

describe('claudeAttachAgentId', () => {
  it('takes the conversation id its first segment', () => {
    expect(claudeAttachAgentId(SESSION_ID)).toBe('84693fdb')
  })

  it('falls back to the id itself when it has no segment', () => {
    expect(claudeAttachAgentId('abc')).toBe('abc')
  })
})
