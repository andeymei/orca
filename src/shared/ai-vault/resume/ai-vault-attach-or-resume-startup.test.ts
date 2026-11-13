import { describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { buildClaudeAttachOrResumeStartup } from './ai-vault-attach-or-resume-startup'

const SESSION_ID = '84693fdb-e203-4b59-81b1-ce59940554aa'

/** A stub CLI that opens the running conversations and records what it was asked to do. */
function createStubCli(runningAgentIds: readonly string[]): { program: string; log: string } {
  const dir = mkdtempSync(join(tmpdir(), 'orca-attach-stub-'))
  const log = join(dir, 'calls.log')
  const program = join(dir, 'claude-stub')
  writeFileSync(
    program,
    [
      '#!/bin/sh',
      `echo "$@" >> ${JSON.stringify(log)}`,
      'if [ "$1" = "attach" ]; then',
      `  if echo " ${runningAgentIds.join(' ')} " | grep -q " $2 "; then`,
      '    echo attached',
      '    exit 0',
      '  fi',
      `  echo "No job matching '$2'."`,
      '  exit 1',
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
  // The native open: attaching keeps the conversation's own id, so no second session appears.
  it('attaches to a conversation that runs on the host', () => {
    const stub = createStubCli([SESSION_ID.slice(0, 8)])
    const startup = buildClaudeAttachOrResumeStartup({
      platform: 'linux',
      agentId: SESSION_ID.slice(0, 8),
      resumeCommand: 'echo resumed-other-session',
      commandOverride: stub.program
    })
    const output = runPosixCommand(startup.command)
    expect(output).toContain('attached')
    expect(output).not.toContain('resumed-other-session')
    expect(readFileSync(stub.log, 'utf8')).toContain(`attach ${SESSION_ID.slice(0, 8)}`)
  })

  it('resumes a conversation nobody runs', () => {
    const stub = createStubCli([])
    const startup = buildClaudeAttachOrResumeStartup({
      platform: 'linux',
      agentId: SESSION_ID.slice(0, 8),
      resumeCommand: 'echo resumed-other-session',
      commandOverride: stub.program
    })
    const output = runPosixCommand(startup.command)
    expect(output).toContain('resumed-other-session')
  })

  it('resumes when the host has no Claude CLI at all', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-attach-stub-'))
    const program = join(dir, 'missing-claude')
    const startup = buildClaudeAttachOrResumeStartup({
      platform: 'linux',
      agentId: SESSION_ID.slice(0, 8),
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
      resumeCommand: "claude --resume 'other'"
    })
    expect(startup.command).toBe(
      `claude attach '${SESSION_ID.slice(0, 8)}'; if ($LASTEXITCODE -ne 0) { claude --resume 'other' }`
    )
  })
})
