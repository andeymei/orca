import { describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildClaudeAttachOrResumeStartup } from './ai-vault-attach-or-resume-startup'

const SESSION_ID = '84693fdb-e203-4b59-81b1-ce59940554aa'

/** A stub CLI that lists the running conversations and records what it was asked to do. */
function createStubCli(args: {
  runningSessionIds: readonly string[]
  /** The exit code the attach ends with; the real CLI ends non-zero when the user leaves it. */
  attachExitCode?: number
}): { program: string; log: string } {
  const dir = mkdtempSync(join(tmpdir(), 'orca-attach-stub-'))
  const log = join(dir, 'calls.log')
  const program = join(dir, 'claude-stub')
  const listing = args.runningSessionIds
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
      `  echo '[${args.runningSessionIds.length > 0 ? `\n${listing}\n` : ''}]'`,
      '  exit 0',
      'fi',
      'if [ "$1" = "attach" ]; then',
      `  if echo " ${args.runningSessionIds.map((id) => id.slice(0, 8)).join(' ')} " | grep -q " $2 "; then`,
      '    echo attached',
      `    exit ${args.attachExitCode ?? 0}`,
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

/** Runs the command and keeps its output; the command may end non-zero, as the attach does. */
function runPosixCommand(command: string): string {
  const result = spawnSync('sh', ['-c', command], { encoding: 'utf8' })
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

describe('buildClaudeAttachOrResumeStartup', () => {
  // The native open: attaching keeps the conversation's own id, so no second session appears.
  it('attaches to a conversation the host reports running', () => {
    const stub = createStubCli({ runningSessionIds: [SESSION_ID] })
    const startup = buildClaudeAttachOrResumeStartup({
      platform: 'linux',
      agentId: SESSION_ID.slice(0, 8),
      sessionId: SESSION_ID,
      resumeCommand: 'echo resumed-other-session',
      commandOverride: stub.program
    })
    const output = runPosixCommand(startup.command)
    expect(output).toContain('attached')
    expect(output).not.toContain('resumed-other-session')
    expect(readFileSync(stub.log, 'utf8')).toContain(`attach ${SESSION_ID.slice(0, 8)}`)
  })

  it('resumes a conversation nobody runs', () => {
    const stub = createStubCli({ runningSessionIds: [] })
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

  it('resumes when the host has no Claude CLI at all', () => {
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

  // The attach ends when the user leaves the attached agent, and that exit code says nothing
  // about whether the conversation runs: a resume after it makes the CLI refuse the conversation
  // the user just opened.
  it('does not resume after the attach ends', () => {
    const stub = createStubCli({ runningSessionIds: [SESSION_ID], attachExitCode: 130 })
    const startup = buildClaudeAttachOrResumeStartup({
      platform: 'linux',
      agentId: SESSION_ID.slice(0, 8),
      sessionId: SESSION_ID,
      resumeCommand: 'echo resumed-other-session',
      commandOverride: stub.program
    })
    const output = runPosixCommand(startup.command)
    expect(output).toContain('attached')
    expect(output).not.toContain('resumed-other-session')
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
      `if (claude agents --json | Select-String -SimpleMatch '${SESSION_ID}') { claude attach '${SESSION_ID.slice(0, 8)}' } else { claude --resume 'other' }`
    )
  })
})
