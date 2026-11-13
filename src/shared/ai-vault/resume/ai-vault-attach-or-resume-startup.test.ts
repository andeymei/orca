import { describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { buildClaudeAttachOrResumeStartup } from './ai-vault-attach-or-resume-startup'

const SESSION_ID = '84693fdb-e203-4b59-81b1-ce59940554aa'

/** A stub CLI that lists one running conversation and records what it was asked to do. */
function createStubCli(runningSessionIds: readonly string[]): { program: string; log: string } {
  const dir = mkdtempSync(join(tmpdir(), 'orca-attach-stub-'))
  const log = join(dir, 'calls.log')
  const program = join(dir, 'claude-stub')
  const listing = runningSessionIds
    .map(
      (id) => `  { "id": "${id.slice(0, 8)}", "sessionId": "${id}", "name": "stub", "cwd": "/tmp" }`
    )
    .join(',\n')
  writeFileSync(
    program,
    [
      '#!/bin/sh',
      `echo "$@" >> ${JSON.stringify(log)}`,
      'if [ "$1" = "agents" ]; then',
      `  echo '[${runningSessionIds.length > 0 ? `\n${listing}\n` : ''}]'`,
      '  exit 0',
      'fi',
      'exit 0',
      ''
    ].join('\n')
  )
  chmodSync(program, 0o755)
  return { program, log }
}

function runPosixCommand(command: string): string {
  return execFileSync('sh', ['-c', command], { encoding: 'utf8' })
}

describe('buildClaudeAttachOrResumeStartup', () => {
  it('asks the host and attaches to a conversation the host reports running', () => {
    const stub = createStubCli([SESSION_ID])
    const startup = buildClaudeAttachOrResumeStartup({
      platform: 'linux',
      agentId: SESSION_ID.slice(0, 8),
      sessionId: SESSION_ID,
      resumeCommand: 'claude --resume other-session',
      commandOverride: stub.program
    })
    runPosixCommand(startup.command)
    const calls = readFileSync(stub.log, 'utf8')
    expect(calls).toContain('agents --json')
    expect(calls).toContain(`attach ${SESSION_ID.slice(0, 8)}`)
    expect(calls).not.toContain('--resume')
  })

  it('resumes a conversation the host does not report running', () => {
    const stub = createStubCli([])
    const startup = buildClaudeAttachOrResumeStartup({
      platform: 'linux',
      agentId: SESSION_ID.slice(0, 8),
      sessionId: SESSION_ID,
      resumeCommand: 'echo resumed-other-session',
      commandOverride: stub.program
    })
    const output = runPosixCommand(startup.command)
    expect(output).toContain('resumed-other-session')
    expect(readFileSync(stub.log, 'utf8')).not.toContain('attach')
  })

  it('resumes when the host cannot list its conversations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-attach-stub-'))
    const program = join(dir, 'missing-claude')
    const startup = buildClaudeAttachOrResumeStartup({
      platform: 'linux',
      agentId: SESSION_ID.slice(0, 8),
      sessionId: SESSION_ID,
      resumeCommand: 'echo resumed-without-listing',
      commandOverride: program
    })
    const output = runPosixCommand(startup.command)
    expect(output).toContain('resumed-without-listing')
  })

  it('writes a PowerShell branch for a Windows host', () => {
    const startup = buildClaudeAttachOrResumeStartup({
      platform: 'win32',
      shell: 'powershell',
      agentId: SESSION_ID.slice(0, 8),
      sessionId: SESSION_ID,
      resumeCommand: "claude --resume 'other'"
    })
    expect(startup.command).toBe(
      `if ((claude agents --json | Out-String) -match '${SESSION_ID}') { claude attach '${SESSION_ID.slice(0, 8)}' } else { claude --resume 'other' }`
    )
  })
})
